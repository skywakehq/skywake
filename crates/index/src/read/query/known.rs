//! The centroids and cluster table entries a query has read so far.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use crate::format::Clusters;
use crate::format::cluster::ClusterRef;
use crate::format::directory::{Directory, Page, Slot};
use crate::format::pages::{PAGE, Paged};
use crate::store::{PARALLELISM, Storage};
use crate::vector::ivf;
use crate::{Error, Metric, Result};

const BATCH: usize = 8;

pub(super) struct Known {
    metric: Metric,
    dims: usize,
    vector: Vec<f32>,
    pub order: Vec<(f32, usize)>,
    source: Source,
}

enum Source {
    Flat {
        table: Paged<ClusterRef>,
        centroids: Arc<Vec<f32>>,
    },
    Paged {
        directory: Arc<Directory>,
        queue: Vec<(f32, usize)>,
        next: usize,
        read: HashMap<usize, Arc<Page>>,
        at: HashMap<usize, (Arc<Page>, usize)>,
    },
}

impl Known {
    pub(super) async fn open(
        storage: &Storage,
        clusters: &Clusters,
        metric: Metric,
        vector: &[f32],
    ) -> Result<Self> {
        let dims = vector.len();
        let (source, order) = match clusters.directory {
            None => {
                let (table, centroids) = futures::try_join!(
                    clusters.table.open(storage),
                    storage.centroids(clusters.centroids)
                )?;
                let order = (centroids.chunks_exact(dims))
                    .map(|centroid| ivf::distance(metric, vector, centroid))
                    .zip(0..)
                    .collect();
                (Source::Flat { table, centroids }, order)
            }
            Some(hash) => {
                let directory: Arc<Directory> = storage.get(hash).await?;
                let mut queue: Vec<(f32, usize)> = (directory.tops.chunks_exact(dims))
                    .zip(&directory.radii)
                    .map(|(top, &radius)| {
                        let score = ivf::distance(metric, vector, top);
                        reach(metric, vector, score, radius).0
                    })
                    .zip(0..)
                    .collect();
                nearest_first(&mut queue);
                let source = Source::Paged {
                    directory,
                    queue,
                    next: 0,
                    read: HashMap::new(),
                    at: HashMap::new(),
                };
                (source, Vec::new())
            }
        };
        let mut known = Self {
            metric,
            dims,
            vector: vector.to_vec(),
            order,
            source,
        };
        nearest_first(&mut known.order);
        Ok(known)
    }

    pub(super) fn get(&self, c: usize) -> &ClusterRef {
        match &self.source {
            Source::Flat { table, .. } => table.get(c),
            Source::Paged { at, .. } => {
                let (page, place) = &at[&c];
                &page.table[*place]
            }
        }
    }

    pub(super) fn centroid(&self, c: usize) -> &[f32] {
        let dims = self.dims;
        match &self.source {
            Source::Flat { centroids, .. } => &centroids[c * dims..(c + 1) * dims],
            Source::Paged { at, .. } => {
                let (page, place) = &at[&c];
                &page.centroids[place * dims..(place + 1) * dims]
            }
        }
    }

    pub(super) async fn settle(&mut self, storage: &Storage, n: usize) -> Result<()> {
        loop {
            let Source::Paged {
                directory,
                queue,
                next,
                read,
                ..
            } = &mut self.source
            else {
                return Ok(());
            };
            while queue.get(*next).is_some_and(|(_, p)| read.contains_key(p)) {
                *next += 1;
            }
            let Some(&(least, _)) = queue.get(*next) else {
                return Ok(());
            };
            let settled = self.order.partition_point(|&(score, _)| score < least);
            if settled >= n {
                return Ok(());
            }
            let unread = (queue[*next..].iter().copied()).filter(|(_, p)| !read.contains_key(p));
            // A page whose least distance is past the n-th known centroid can't change the first n.
            let wanted: Vec<usize> = match self.order.get(n.saturating_sub(1)) {
                Some(&(bound, _)) => (unread.take_while(|&(lower, _)| lower <= bound))
                    .map(|(_, p)| p)
                    .take(BATCH)
                    .collect(),
                None => {
                    let mut short = n - self.order.len();
                    (unread.take_while(|&(_, p)| {
                        let more = short > 0;
                        short = short.saturating_sub(directory.sizes[p] as usize);
                        more
                    }))
                    .map(|(_, p)| p)
                    .collect()
                }
            };
            self.read(storage, wanted).await?;
        }
    }

    pub(super) async fn load(
        &mut self,
        storage: &Storage,
        clusters: impl IntoIterator<Item = usize>,
    ) -> Result<()> {
        let Source::Paged { directory, at, .. } = &self.source else {
            return Ok(());
        };
        let missing: BTreeSet<usize> = (clusters.into_iter())
            .filter(|c| !at.contains_key(c))
            .collect();
        let slot_pages: BTreeSet<usize> = missing.iter().map(|c| c / PAGE).collect();
        let hashes = slot_pages.iter().map(|&p| directory.slots.hashes[p]);
        let slots: Vec<Arc<Vec<Slot>>> = storage.get_all(hashes.collect()).await?;
        let slots: HashMap<usize, Arc<Vec<Slot>>> = slot_pages.into_iter().zip(slots).collect();
        let pages: BTreeSet<usize> = (missing.iter())
            .map(|c| slots[&(c / PAGE)][c % PAGE].0 as usize)
            .collect();
        self.read(storage, pages.into_iter().collect()).await
    }

    async fn read(&mut self, storage: &Storage, pages: Vec<usize>) -> Result<()> {
        let Source::Paged {
            directory,
            read,
            at,
            ..
        } = &mut self.source
        else {
            return Ok(());
        };
        let pages: Vec<usize> = pages
            .into_iter()
            .filter(|p| !read.contains_key(p))
            .collect();
        let found: Vec<(usize, Arc<Page>)> = stream::iter(pages)
            .map(|p| {
                let hash = directory.pages[p];
                async move { Ok::<_, Error>((p, storage.get::<Page>(hash).await?)) }
            })
            .buffer_unordered(PARALLELISM)
            .try_collect()
            .await?;
        for (p, page) in found {
            let centroids = page.centroids.chunks_exact(self.dims);
            for (place, (&c, centroid)) in page.clusters.iter().zip(centroids).enumerate() {
                let score = ivf::distance(self.metric, &self.vector, centroid);
                self.order.push((score, c as usize));
                at.insert(c as usize, (page.clone(), place));
            }
            read.insert(p, page);
        }
        nearest_first(&mut self.order);
        Ok(())
    }
}

fn nearest_first(order: &mut [(f32, usize)]) {
    order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
}

pub(super) fn reach(metric: Metric, vector: &[f32], score: f32, radius: f32) -> (f32, f32) {
    let slack = 1e-4 * (1.0 + score.abs());
    let (near, far) = match metric {
        Metric::Euclidean => {
            let d = score.max(0.0).sqrt();
            ((d - radius).max(0.0).powi(2), (d + radius).powi(2))
        }
        Metric::Dot => {
            let norm = ivf::dot(vector, vector).sqrt();
            (score - norm * radius, score + norm * radius)
        }
        Metric::Cosine => (score - radius, score + radius),
    };
    (near - slack, far + slack)
}
