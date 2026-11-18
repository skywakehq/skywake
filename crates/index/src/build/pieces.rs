//! One column of an append build: which pieces to write, then writing them.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use super::{Coding, blocking, groups as chunked, store_clusters};
use crate::format::cluster::{self, Cluster, ClusterRef};
use crate::read::tail::{Row, Tail};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::groups::Groups;
use crate::vector::reshape::{self, Plan};
use crate::{Column, Id, Result};

const FOLD: u64 = 2;

const TIER: usize = 4;

pub(super) struct Source<'a> {
    pub storage: &'a Storage,
    pub tail: &'a Tail,
    pub live: &'a [(&'a Id, Row)],
    pub leave: &'a HashMap<u32, HashSet<&'a Id>>,
    pub column: usize,
    pub spec: Column,
}

pub(super) struct Layout {
    pub table: Vec<ClusterRef>,
    pub centroids: Vec<f32>,
    pub groups: Groups,
    pub joins: Vec<Vec<usize>>,
    pub sizes: Vec<u64>,
}

impl Layout {
    pub(super) async fn new(
        source: &Source<'_>,
        table: Vec<ClusterRef>,
        centroids: Arc<Vec<f32>>,
    ) -> Result<Self> {
        let (dims, spec) = (source.spec.dims, source.spec);
        let data: Vec<f32> = (source.live.iter())
            .flat_map(|&(_, row)| {
                source
                    .tail
                    .segment(row)
                    .vector(source.column, dims, row.row)
            })
            .copied()
            .collect();
        let shared = centroids.clone();
        let (groups, assigned) = blocking(move || {
            let groups = Groups::new(&shared, dims);
            let assigned = crate::vector::groups::assign(&data, &groups.centroids, &spec);
            (groups, assigned)
        })
        .await?;
        let mut joins = vec![Vec::new(); groups.len()];
        for (i, g) in assigned.into_iter().enumerate() {
            joins[g as usize].push(i);
        }
        let left = |e: u32| table[e as usize].rows - leaving(source.leave, e as usize) as u64;
        let sizes = (groups.members.iter().zip(&joins))
            .map(|(members, joins)| {
                members.iter().map(|&e| left(e)).sum::<u64>() + joins.len() as u64
            })
            .collect();
        Ok(Self {
            table,
            centroids: centroids.to_vec(),
            groups,
            joins,
            sizes,
        })
    }
}

fn leaving(leave: &HashMap<u32, HashSet<&Id>>, e: usize) -> usize {
    leave.get(&(e as u32)).map_or(0, HashSet::len)
}

enum Job {
    Write {
        dest: usize,
        sources: Vec<usize>,
        joins: Vec<usize>,
        centroid: Centroid,
    },
    Split {
        stay: usize,
        go: Vec<usize>,
        sources: Vec<usize>,
        joins: Vec<usize>,
    },
}

#[derive(Clone, Copy)]
enum Centroid {
    Keep,
    Of(usize),
    Mean,
}

impl Job {
    fn sources(&self) -> &[usize] {
        match self {
            Job::Write { sources, .. } | Job::Split { sources, .. } => sources,
        }
    }
}

struct Decisions<'l> {
    layout: &'l Layout,
    leave: &'l HashMap<u32, HashSet<&'l Id>>,
    members: Vec<Vec<usize>>,
    owner: Vec<usize>,
    pool: Vec<usize>,
    next: usize,
    jobs: Vec<Job>,
    emptied: Vec<(usize, usize)>,
    rows: HashMap<usize, u64>,
    fold_bytes: u64,
}

impl<'l> Decisions<'l> {
    fn new(
        layout: &'l Layout,
        leave: &'l HashMap<u32, HashSet<&'l Id>>,
        plan: &Plan,
        fold_bytes: u64,
    ) -> Self {
        let members: Vec<Vec<usize>> = (layout.groups.members.iter())
            .map(|m| m.iter().map(|&e| e as usize).collect())
            .collect();
        let mut owner = vec![0; layout.table.len()];
        for (g, members) in members.iter().enumerate() {
            members.iter().for_each(|&e| owner[e] = g);
        }
        let planned: HashSet<usize> = (plan.merges.iter())
            .flat_map(|&(a, b)| [a, b])
            .chain(plan.splits.iter().map(|&(from, _)| from))
            .collect();
        let mut pool: Vec<usize> = (0..layout.table.len())
            .filter(|&e| {
                let g = owner[e];
                layout.table[e].rows == leaving(leave, e) as u64
                    && layout.joins[g].is_empty()
                    && !planned.contains(&g)
            })
            .collect();
        pool.reverse();
        Self {
            layout,
            leave,
            members,
            owner,
            pool,
            next: layout.table.len(),
            jobs: Vec::new(),
            emptied: Vec::new(),
            rows: HashMap::new(),
            fold_bytes,
        }
    }

    fn left(&self, e: usize) -> u64 {
        match self.rows.get(&e) {
            Some(&rows) => rows,
            None => self.layout.table[e].rows - leaving(self.leave, e) as u64,
        }
    }

    fn spare(&mut self) -> usize {
        while let Some(e) = self.pool.pop() {
            let g = self.owner[e];
            if let Some(at) = self.members[g].iter().position(|&m| m == e) {
                self.members[g].remove(at);
                return e;
            }
        }
        self.next += 1;
        self.next - 1
    }

    fn empty(&mut self, dest: usize, like: usize) {
        self.rows.insert(dest, 0);
        self.emptied.push((dest, like));
    }

    fn reshape(&mut self, plan: &Plan) {
        let mut freed: HashMap<usize, usize> = HashMap::new();
        for &(from, into) in &plan.merges {
            let dest = self.base(into);
            let mut sources: Vec<usize> = self.members[into].clone();
            sources.extend(&self.members[from]);
            let joins = [&self.layout.joins[into][..], &self.layout.joins[from][..]].concat();
            freed.insert(from, self.base(from));
            for &e in &sources {
                if e != dest {
                    self.empty(e, dest);
                }
            }
            self.rows.insert(dest, 0);
            self.jobs.push(Job::Write {
                dest,
                sources,
                joins,
                centroid: Centroid::Mean,
            });
        }
        let groups = self.layout.groups.len();
        for (from, to) in &plan.splits {
            let from = *from;
            let stay = self.base(from);
            let go: Vec<usize> = (to.iter())
                .map(|&to| match freed.remove(&to) {
                    Some(e) => {
                        self.emptied.retain(|&(dest, _)| dest != e);
                        e
                    }
                    None if to < groups => self.base(to),
                    None => self.spare(),
                })
                .collect();
            let sources = self.members[from].clone();
            for &e in &sources {
                if e != stay && !go.contains(&e) {
                    self.empty(e, stay);
                }
            }
            for &e in std::iter::once(&stay).chain(&go) {
                self.rows.insert(e, 0);
            }
            let joins = self.layout.joins[from].clone();
            self.jobs.push(Job::Split {
                stay,
                go,
                sources,
                joins,
            });
        }
    }

    fn base(&self, g: usize) -> usize {
        (self.members[g].iter().copied())
            .max_by_key(|&e| (self.left(e), std::cmp::Reverse(e)))
            .expect("a cluster group has a piece")
    }

    fn overdue(&self, g: usize) -> u64 {
        let base = self.base(g);
        let pending: u64 = (self.members[g].iter())
            .filter(|&&e| e != base)
            .map(|&e| self.left(e))
            .sum();
        (pending + self.layout.joins[g].len() as u64) * 1024 / self.left(base).max(1)
    }

    fn append(&mut self, g: usize) {
        let layout = self.layout;
        let joins = &layout.joins[g];
        let members = self.members[g].clone();
        let base = self.base(g);
        let base_rows = self.left(base);
        let deltas: Vec<usize> = (members.iter().copied())
            .filter(|&e| e != base && self.left(e) > 0)
            .collect();
        let delta_rows: u64 = deltas.iter().map(|&e| self.left(e)).sum();
        let bytes: u64 = (std::iter::once(base).chain(deltas.iter().copied()))
            .map(|e| layout.table[e].bytes())
            .sum();
        let fold = base_rows == 0
            || ((delta_rows + joins.len() as u64) * FOLD >= base_rows && bytes <= self.fold_bytes);
        if fold {
            if base_rows > 0 {
                self.fold_bytes -= bytes;
            }
            for &e in &members {
                if e != base && (self.left(e) > 0 || leaving(self.leave, e) > 0) {
                    self.empty(e, e);
                }
            }
            self.rows
                .insert(base, base_rows + delta_rows + joins.len() as u64);
            let sources = std::iter::once(base).chain(deltas).collect();
            self.write(base, sources, joins.clone(), g);
            return;
        }
        let mut rows = joins.len() as u64;
        let mut merged: Vec<usize> = Vec::new();
        let mut rest = deltas;
        loop {
            let tier = level(rows);
            let same: Vec<usize> = (rest.iter().copied())
                .filter(|&e| level(self.left(e)) == tier)
                .collect();
            if same.len() + 1 < TIER {
                break;
            }
            rows += same.iter().map(|&e| self.left(e)).sum::<u64>();
            rest.retain(|e| !same.contains(e));
            merged.extend(same);
        }
        let dest = match merged.first() {
            Some(&e) => e,
            None => match (members.iter().copied()).find(|&e| e != base && self.left(e) == 0) {
                Some(e) => e,
                None => {
                    let e = self.spare();
                    self.owner.resize(self.owner.len().max(e + 1), g);
                    self.owner[e] = g;
                    self.members[g].push(e);
                    e
                }
            },
        };
        for &e in merged.iter().skip(1) {
            self.empty(e, e);
        }
        self.rows.insert(dest, rows);
        self.write(dest, merged, joins.clone(), g);
        self.rewrite_leaving(&members);
    }

    fn rewrite_leaving(&mut self, members: &[usize]) {
        for &e in members {
            if leaving(self.leave, e) == 0 || self.rows.contains_key(&e) {
                continue;
            }
            let left = self.left(e);
            if left == 0 {
                self.empty(e, e);
                continue;
            }
            self.rows.insert(e, left);
            let g = self.owner[e];
            self.write(e, vec![e], Vec::new(), g);
        }
    }

    fn write(&mut self, dest: usize, sources: Vec<usize>, joins: Vec<usize>, g: usize) {
        let like = self.layout.groups.members[g][0] as usize;
        self.jobs.push(Job::Write {
            dest,
            sources,
            joins,
            centroid: match dest == like {
                true => Centroid::Keep,
                false => Centroid::Of(like),
            },
        });
    }
}

fn level(rows: u64) -> u32 {
    rows.max(1).ilog2() / 2
}

#[derive(Clone, Copy)]
pub(super) enum Origin {
    Piece(usize),
    New(usize),
}

#[derive(Default)]
struct Rows {
    cluster: Cluster,
    from: Vec<Origin>,
}

impl Rows {
    fn extend(&mut self, other: Rows) {
        reshape::merge(&mut self.cluster, other.cluster);
        self.from.extend(other.from);
    }

    fn split(self, sides: &[u32], parts: usize, dims: usize) -> Vec<Rows> {
        let mut out: Vec<Rows> = (0..parts).map(|_| Rows::default()).collect();
        let cluster = self.cluster;
        let rows = (cluster.ids.into_iter())
            .zip(cluster.seqs)
            .zip(cluster.attributes)
            .zip(self.from);
        for (row, (((id, seq), attributes), from)) in rows.enumerate() {
            let part = &mut out[sides[row] as usize];
            part.cluster.ids.push(id);
            part.cluster.seqs.push(seq);
            part.cluster.attributes.push(attributes);
            (part.cluster.vectors).extend(&cluster.vectors[row * dims..(row + 1) * dims]);
            part.from.push(from);
        }
        out
    }
}

pub(super) struct Built {
    pub changes: BTreeMap<usize, ClusterRef>,
    pub centroids: Vec<f32>,
    pub placed: Vec<(Origin, Id, usize)>,
}

pub(super) async fn apply(
    source: &Source<'_>,
    mut layout: Layout,
    plan: &Plan,
    coding: &mut Coding,
    (budget, fold_bytes): (usize, u64),
    written: &mut Written,
) -> Result<Built> {
    let mut decisions = Decisions::new(&layout, source.leave, plan, fold_bytes);
    decisions.reshape(plan);
    let planned: HashSet<usize> = (plan.merges.iter())
        .flat_map(|&(a, b)| [a, b])
        .chain(plan.splits.iter().map(|&(from, _)| from))
        .collect();
    let groups = layout.groups.len();
    let mut appended: Vec<usize> = (0..groups)
        .filter(|g| !planned.contains(g) && !layout.joins[*g].is_empty())
        .collect();
    appended.sort_by_cached_key(|&g| std::cmp::Reverse(decisions.overdue(g)));
    for g in appended {
        decisions.append(g);
    }
    for g in (0..groups).filter(|g| !planned.contains(g)) {
        if layout.joins[g].is_empty() {
            let members = decisions.members[g].clone();
            decisions.rewrite_leaving(&members);
        }
    }
    let (jobs, mut emptied, next) = (decisions.jobs, decisions.emptied, decisions.next);
    let mut late = Vec::new();
    let dims = source.spec.dims;
    layout.centroids.resize(next * dims, 0.0);
    let mut out = Built {
        changes: BTreeMap::new(),
        centroids: Vec::new(),
        placed: Vec::new(),
    };
    let size = |job: &Job| -> usize {
        (job.sources().iter())
            .map(|&e| layout.table[e].bytes() as usize)
            .sum::<usize>()
            .max(1)
    };
    for chunk in chunked(&jobs, budget, size) {
        let mut read = read_sources(source, &layout.table, chunk).await?;
        let mut filled: Vec<(usize, Cluster)> = Vec::new();
        for job in chunk {
            let rows = gather(source, &mut read, job);
            match job {
                Job::Write { dest, centroid, .. } => {
                    let centroid = match *centroid {
                        Centroid::Keep => None,
                        Centroid::Of(like) => {
                            Some(layout.centroids[like * dims..(like + 1) * dims].to_vec())
                        }
                        Centroid::Mean => Some(reshape::centroid(&rows.cluster, &source.spec)),
                    };
                    if let Some(centroid) = centroid {
                        layout.centroids[dest * dims..(dest + 1) * dims].copy_from_slice(&centroid);
                    }
                    filled.push(place(&mut out, *dest, rows));
                }
                Job::Split { stay, go, .. } => {
                    let (spec, parts) = (source.spec, go.len() + 1);
                    let (rows, sides) = blocking(move || {
                        let sides = reshape::sides(&rows.cluster, &spec, parts);
                        (rows, sides)
                    })
                    .await?;
                    let dests = std::iter::once(*stay).chain(go.iter().copied());
                    for (dest, part) in dests.zip(rows.split(&sides, parts, dims)) {
                        if part.cluster.ids.is_empty() {
                            late.push((dest, *stay));
                            continue;
                        }
                        let centroid = reshape::centroid(&part.cluster, &source.spec);
                        layout.centroids[dest * dims..(dest + 1) * dims].copy_from_slice(&centroid);
                        filled.push(place(&mut out, dest, part));
                    }
                }
            }
        }
        coding.centroids = Arc::new(layout.centroids.clone());
        let places: Vec<usize> = filled.iter().map(|(e, _)| *e).collect();
        let stored = store_clusters(source.storage, filled, coding, written).await?;
        out.changes.extend(places.into_iter().zip(stored));
    }
    emptied.extend(late);
    let mut empty = Vec::new();
    for &(dest, like) in &emptied {
        if dest != like {
            let centroid = layout.centroids[like * dims..(like + 1) * dims].to_vec();
            layout.centroids[dest * dims..(dest + 1) * dims].copy_from_slice(&centroid);
        }
        empty.push((dest, Cluster::default()));
    }
    coding.centroids = Arc::new(layout.centroids.clone());
    let places: Vec<usize> = empty.iter().map(|(e, _)| *e).collect();
    let stored = store_clusters(source.storage, empty, coding, written).await?;
    out.changes.extend(places.into_iter().zip(stored));
    out.centroids = layout.centroids;
    Ok(out)
}

fn place(out: &mut Built, dest: usize, rows: Rows) -> (usize, Cluster) {
    for (id, &from) in rows.cluster.ids.iter().zip(&rows.from) {
        match from {
            Origin::Piece(e) if e == dest => {}
            from => out.placed.push((from, id.clone(), dest)),
        }
    }
    (dest, rows.cluster)
}

async fn read_sources(
    source: &Source<'_>,
    table: &[ClusterRef],
    jobs: &[Job],
) -> Result<HashMap<usize, Rows>> {
    let wanted: Vec<usize> = (jobs.iter().flat_map(Job::sources).copied())
        .filter(|&e| table[e].rows > 0)
        .collect();
    stream::iter(wanted)
        .map(|e| async move { Ok::<_, crate::Error>((e, read_piece(source, e, &table[e]).await?)) })
        .buffered(PARALLELISM)
        .try_collect()
        .await
}

async fn read_piece(source: &Source<'_>, e: usize, piece: &ClusterRef) -> Result<Rows> {
    let dims = source.spec.dims;
    let leaving = source.leave.get(&(e as u32));
    let old = cluster::decode(&source.storage.blob(piece.hash).await?)?;
    let mut rows = Rows::default();
    for (i, id) in old.ids.into_iter().enumerate() {
        if leaving.is_some_and(|leaving| leaving.contains(&id)) {
            continue;
        }
        rows.cluster.seqs.push(old.seqs[i]);
        (rows.cluster.vectors).extend(&old.vectors[i * dims..(i + 1) * dims]);
        rows.cluster.attributes.push(old.attributes[i].clone());
        rows.cluster.ids.push(id);
        rows.from.push(Origin::Piece(e));
    }
    Ok(rows)
}

fn gather(source: &Source<'_>, read: &mut HashMap<usize, Rows>, job: &Job) -> Rows {
    let (sources, joins) = match job {
        Job::Write { sources, joins, .. } | Job::Split { sources, joins, .. } => (sources, joins),
    };
    let mut rows = Rows::default();
    for e in sources {
        if let Some(piece) = read.remove(e) {
            rows.extend(piece);
        }
    }
    let dims = source.spec.dims;
    for &i in joins {
        let (id, row) = source.live[i];
        let segment = source.tail.segment(row);
        rows.cluster.ids.push(id.clone());
        rows.cluster.seqs.push(row.seq);
        (rows.cluster.vectors).extend(segment.vector(source.column, dims, row.row));
        rows.cluster
            .attributes
            .push(segment.attributes[row.row].clone());
        rows.from.push(Origin::New(i));
    }
    rows
}
