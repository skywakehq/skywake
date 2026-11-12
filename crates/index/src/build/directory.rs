//! Writes the directory that lets a query read a few pages of centroids, not all of them.

use std::collections::BTreeMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use skywake_core::Hash;

use super::blocking;
use crate::format::Clusters;
use crate::format::cluster::ClusterRef;
use crate::format::directory::{Directory, Page, Slot};
use crate::format::pages::{Paged, Pages};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::ivf;
use crate::{Column, Metric, Result};

const PAGED_FROM: usize = 4096;

const PAGE_BYTES: usize = 2 << 20;

const TOP_BYTES: usize = 8 << 20;

pub(super) async fn refresh(
    storage: &Storage,
    column: &Column,
    old: Option<&Clusters>,
    new: Clusters,
    written: &mut Written,
) -> Result<Clusters> {
    let count = new.table.len as usize;
    let old = old.filter(|old| old.table.len <= new.table.len);
    match old.and_then(|old| Some((old, old.directory?))) {
        Some((old, hash)) if old.table == new.table && old.centroids == new.centroids => {
            Ok(Clusters {
                directory: Some(hash),
                ..new
            })
        }
        Some((old, hash)) => update(storage, column, (old, hash), new, written).await,
        None if count >= PAGED_FROM => {
            let per_page = per_page(count, column.dims);
            write(storage, column, new, per_page, written).await
        }
        None => Ok(Clusters {
            directory: None,
            ..new
        }),
    }
}

fn per_page(count: usize, dims: usize) -> usize {
    let most = PAGE_BYTES / (4 * dims + size_of::<ClusterRef>());
    (count as f64).sqrt().ceil().clamp(1.0, most.max(1) as f64) as usize
}

pub(crate) async fn write(
    storage: &Storage,
    column: &Column,
    clusters: Clusters,
    per_page: usize,
    written: &mut Written,
) -> Result<Clusters> {
    let dims = column.dims;
    let (table, centroids) = futures::try_join!(
        clusters.table.open::<ClusterRef>(storage),
        storage.centroids(clusters.centroids),
    )?;
    let groups = {
        let centroids = centroids.clone();
        blocking(move || group(&centroids, dims, per_page)).await?
    };
    let mut directory = Directory {
        per_page: per_page as u32,
        tops: Vec::new(),
        radii: Vec::new(),
        sizes: Vec::new(),
        pages: Vec::new(),
        slots: Pages::default(),
    };
    let mut slots: Vec<Slot> = vec![(0, 0); clusters.table.len as usize];
    for members in &groups {
        let p = add_page(&mut directory, &centroids, dims, members);
        for (place, &c) in members.iter().enumerate() {
            slots[c as usize] = (p as u32, place as u32);
        }
    }
    let changed = groups.into_iter().enumerate().collect();
    let new = (&table, centroids.as_slice(), dims);
    store_pages(storage, new, &mut directory, changed, written).await?;
    directory.slots = Pages::write(storage, &slots, written).await?;
    finish(storage, column, clusters, &centroids, directory, written).await
}

async fn update(
    storage: &Storage,
    column: &Column,
    (old, hash): (&Clusters, Hash),
    new: Clusters,
    written: &mut Written,
) -> Result<Clusters> {
    let dims = column.dims;
    let mut directory = (*storage.get::<Directory>(hash).await?).clone();
    let per_page = directory.per_page as usize;
    let (old_table, new_table, old_centroids, new_centroids, slots) = futures::try_join!(
        old.table.open::<ClusterRef>(storage),
        new.table.open::<ClusterRef>(storage),
        storage.centroids(old.centroids),
        storage.centroids(new.centroids),
        directory.slots.open::<Slot>(storage),
    )?;
    let (before, after) = (old.table.len as usize, new.table.len as usize);
    let mut changed: BTreeMap<usize, Vec<u32>> = BTreeMap::new();
    for c in 0..before {
        let at = c * dims..(c + 1) * dims;
        if old_table.get(c) != new_table.get(c) || old_centroids[at.clone()] != new_centroids[at] {
            changed.entry(slots.get(c).0 as usize).or_default();
        }
    }
    let added = new_centroids[before * dims..after * dims].to_vec();
    let tops = directory.tops.clone();
    let nearest = blocking(move || ivf::assign(&added, dims, &tops, Metric::Euclidean)).await?;
    let mut more: Vec<Slot> = Vec::new();
    let mut spill: Vec<u32> = Vec::new();
    for (c, p) in (before as u32..).zip(nearest) {
        let size = &mut directory.sizes[p as usize];
        if (*size as usize) < per_page {
            more.push((p, *size));
            *size += 1;
            changed.entry(p as usize).or_default().push(c);
        } else {
            spill.push(c);
            more.push((0, 0));
        }
    }
    let mut pages: Vec<(usize, Vec<u32>)> = stream::iter(changed)
        .map(|(p, added)| {
            let hash = directory.pages[p];
            async move {
                let page = storage.get::<Page>(hash).await?;
                Ok::<_, crate::Error>((p, [page.clusters.clone(), added].concat()))
            }
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    for members in spill.chunks(per_page) {
        let p = add_page(&mut directory, &new_centroids, dims, members);
        for (place, &c) in members.iter().enumerate() {
            more[c as usize - before] = (p as u32, place as u32);
        }
        pages.push((p, members.to_vec()));
    }
    let now = (&new_table, new_centroids.as_slice(), dims);
    store_pages(storage, now, &mut directory, pages, written).await?;
    directory.slots = directory.slots.append(storage, &more, written).await?;
    finish(storage, column, new, &new_centroids, directory, written).await
}

async fn store_pages(
    storage: &Storage,
    (table, centroids, dims): (&Paged<ClusterRef>, &[f32], usize),
    directory: &mut Directory,
    pages: Vec<(usize, Vec<u32>)>,
    written: &mut Written,
) -> Result<()> {
    let mut encoded = Vec::with_capacity(pages.len());
    for (p, members) in pages {
        let page = Page {
            centroids: ivf::gather(centroids, dims, members.iter().map(|&c| c as usize)),
            table: members
                .iter()
                .map(|&c| table.get(c as usize).clone())
                .collect(),
            clusters: members,
        };
        let top = &directory.tops[p * dims..(p + 1) * dims];
        directory.radii[p] = (page.centroids.chunks_exact(dims))
            .map(|centroid| ivf::squared_distance(top, centroid).sqrt())
            .fold(0.0, f32::max);
        encoded.push((p, postcard::to_stdvec(&page)?));
    }
    let stored: Vec<(usize, Hash)> = stream::iter(encoded)
        .map(|(p, bytes)| async move { Ok::<_, crate::Error>((p, storage.put(bytes).await?)) })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    for (p, hash) in stored {
        directory.pages[p] = hash;
        written.chunks([hash]);
    }
    Ok(())
}

async fn finish(
    storage: &Storage,
    column: &Column,
    mut clusters: Clusters,
    centroids: &Arc<Vec<f32>>,
    directory: Directory,
    written: &mut Written,
) -> Result<Clusters> {
    let bytes = postcard::to_stdvec(&directory)?;
    if bytes.len() > TOP_BYTES {
        clusters.directory = None;
        return Ok(clusters);
    }
    let hash = storage.put(bytes).await?;
    written.chunks([hash]);
    clusters.directory = Some(hash);
    if clusters.origin.is_none() {
        let origin = storage
            .put_centroids(&ivf::mean(centroids, column.dims))
            .await?;
        written.object(origin);
        clusters.origin = Some(origin);
    }
    Ok(clusters)
}

fn group(centroids: &[f32], dims: usize, per_page: usize) -> Vec<Vec<u32>> {
    let count = centroids.len() / dims.max(1);
    let k = count.div_ceil(per_page.max(1));
    let tops = ivf::train(centroids, dims, k, Metric::Euclidean);
    let mut groups: Vec<Vec<u32>> = vec![Vec::new(); tops.len() / dims.max(1)];
    for (c, g) in ivf::assign(centroids, dims, &tops, Metric::Euclidean)
        .into_iter()
        .enumerate()
    {
        groups[g as usize].push(c as u32);
    }
    (groups.iter())
        .flat_map(|members| members.chunks(per_page.max(1)))
        .filter(|members| !members.is_empty())
        .map(<[u32]>::to_vec)
        .collect()
}

fn add_page(directory: &mut Directory, centroids: &[f32], dims: usize, members: &[u32]) -> usize {
    let picked = ivf::gather(centroids, dims, members.iter().map(|&c| c as usize));
    directory.tops.extend(ivf::mean(&picked, dims));
    directory.radii.push(0.0);
    directory.sizes.push(members.len() as u32);
    directory.pages.push(Hash::of(&[]));
    directory.pages.len() - 1
}
