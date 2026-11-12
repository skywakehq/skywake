//! The trees of a branch, fetched from packs as folders are opened.

use std::collections::{HashMap, HashSet};
use std::ops::Bound::{Excluded, Unbounded};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use futures::future::try_join_all;
use futures::{StreamExt, TryStreamExt, stream};
use postcard::experimental::serialized_size;
use tokio::sync::OnceCell;

use crate::error;
use crate::model::{Pack, Packs, valid_entry_name};
use crate::{Entry, Error, Hash, Objects, Result, Tree};
use pack::Packer;

mod pack;

const RECENT_MAX: usize = 64 * 1024;

const REPACK_MIN: u64 = 4 * 1024 * 1024;

const ENTRY_MIN: usize = 4;

const PARALLELISM: usize = 16;

const PARTS_KEPT: usize = 256;

#[derive(Clone)]
pub struct Trees {
    objects: Objects,
    known: Arc<Mutex<Known>>,
}

#[derive(Default)]
struct Known {
    trees: HashMap<Hash, Arc<Tree>>,
    packs: HashMap<Hash, Hash>,
    parts: HashMap<Hash, Arc<Vec<Hash>>>,
    stored_parts: HashSet<Hash>,
    part_trees: HashMap<Hash, Arc<Tree>>,
    loads: HashMap<Hash, Arc<OnceCell<()>>>,
    since: Option<SystemTime>,
}

pub(crate) type Layout = (Packs, Vec<Pack>, Vec<Tree>);

enum Fetch {
    Pack(Hash),
    Parts(Arc<Vec<Hash>>),
}

impl Trees {
    pub fn new(objects: Objects, packs: &Packs) -> Result<Self> {
        let mut known = Known {
            packs: packs.packed.iter().copied().collect(),
            since: Some(SystemTime::now()),
            ..Known::default()
        };
        for tree in &packs.recent {
            let hash = Objects::address(tree)?;
            check_names(hash, tree)?;
            known.trees.insert(hash, Arc::new(tree.clone()));
        }
        Ok(Self {
            objects,
            known: Arc::new(Mutex::new(known)),
        })
    }

    pub fn add(&self, tree: Tree) -> Result<Hash> {
        let hash = Objects::address(&tree)?;
        self.lock()
            .trees
            .entry(hash)
            .or_insert_with(|| Arc::new(tree));
        Ok(hash)
    }

    pub fn absorb(&self, other: &Trees) {
        if Arc::ptr_eq(&self.known, &other.known) {
            return;
        }
        let (trees, packs, parts, stored_parts, since) = {
            let other = other.lock();
            (
                other.trees.clone(),
                other.packs.clone(),
                other.parts.clone(),
                other.stored_parts.clone(),
                other.since(),
            )
        };
        self.started(since);
        let mut known = self.lock();
        for (hash, tree) in trees {
            known.trees.entry(hash).or_insert(tree);
        }
        for (hash, pack) in packs {
            known.packs.entry(hash).or_insert(pack);
        }
        for (hash, list) in parts {
            known.parts.entry(hash).or_insert(list);
        }
        known.stored_parts.extend(stored_parts);
    }

    pub async fn get(&self, hash: Hash) -> Result<Arc<Tree>> {
        for _ in 0..3 {
            let (fetch, load) = {
                let mut known = self.lock();
                if let Some(tree) = known.trees.get(&hash) {
                    return Ok(tree.clone());
                }
                let (fetch, key) = match known.parts.get(&hash) {
                    Some(parts) => (Fetch::Parts(parts.clone()), hash),
                    None => {
                        let pack = *known.packs.get(&hash).ok_or_else(|| missing(hash))?;
                        (Fetch::Pack(pack), pack)
                    }
                };
                (fetch, known.loads.entry(key).or_default().clone())
            };
            match fetch {
                Fetch::Pack(pack) => load.get_or_try_init(|| self.load(pack)).await?,
                Fetch::Parts(parts) => {
                    load.get_or_try_init(|| self.load_parts(hash, &parts))
                        .await?
                }
            };
        }
        Err(missing(hash))
    }

    pub async fn entry(&self, tree: Hash, name: &str) -> Result<Option<Entry>> {
        let Some(parts) = self.parts_of(tree).await? else {
            return Ok(self.get(tree).await?.get(name).cloned());
        };
        let (mut low, mut high) = (0, parts.len());
        while low < high {
            let middle = (low + high) / 2;
            let part = self.part(parts[middle]).await?;
            let (Some((first, _)), Some((last, _))) =
                (part.first_key_value(), part.last_key_value())
            else {
                return Err(Error::Corrupt(format!("part {} is empty", parts[middle])));
            };
            if name < first.as_str() {
                high = middle;
            } else if name > last.as_str() {
                low = middle + 1;
            } else {
                return Ok(part.get(name).cloned());
            }
        }
        Ok(None)
    }

    pub async fn page(
        &self,
        tree: Hash,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<(String, Entry)>> {
        let take = |tree: &Tree, found: &mut Vec<(String, Entry)>| {
            let range = match after {
                Some(after) => tree.range::<str, _>((Excluded(after), Unbounded)),
                None => tree.range::<str, _>(..),
            };
            let room = limit - found.len();
            found.extend(
                range
                    .take(room)
                    .map(|(name, entry)| (name.clone(), entry.clone())),
            );
        };
        let mut found = Vec::new();
        let Some(parts) = self.parts_of(tree).await? else {
            take(&*self.get(tree).await?, &mut found);
            return Ok(found);
        };
        let (mut low, mut high) = (0, parts.len());
        if let Some(after) = after {
            while low < high {
                let middle = (low + high) / 2;
                let part = self.part(parts[middle]).await?;
                match part.last_key_value() {
                    Some((last, _)) if last.as_str() > after => high = middle,
                    _ => low = middle + 1,
                }
            }
        }
        for &part in &parts[low..] {
            if found.len() >= limit {
                break;
            }
            take(&*self.part(part).await?, &mut found);
        }
        Ok(found)
    }

    async fn parts_of(&self, tree: Hash) -> Result<Option<Arc<Vec<Hash>>>> {
        let pack = {
            let known = self.lock();
            if known.trees.contains_key(&tree) {
                return Ok(None);
            }
            if let Some(parts) = known.parts.get(&tree) {
                return Ok(Some(parts.clone()));
            }
            match known.packs.get(&tree) {
                Some(pack) => *pack,
                None => return Ok(None),
            }
        };
        let load = self.lock().loads.entry(pack).or_default().clone();
        load.get_or_try_init(|| self.load(pack)).await?;
        Ok(self.lock().parts.get(&tree).cloned())
    }

    async fn part(&self, hash: Hash) -> Result<Arc<Tree>> {
        if let Some(part) = self.lock().part_trees.get(&hash) {
            return Ok(part.clone());
        }
        let part: Arc<Tree> = Arc::new(self.objects.get(hash).await?);
        check_names(hash, &part)?;
        let mut known = self.lock();
        if known.part_trees.len() >= PARTS_KEPT {
            known.part_trees.clear();
        }
        known.part_trees.insert(hash, part.clone());
        Ok(part)
    }

    async fn load(&self, pack: Hash) -> Result<()> {
        self.learn(pack, self.objects.get(pack).await?)
    }

    pub async fn load_packs(&self) -> Result<Vec<Hash>> {
        let mut found: Vec<Hash> = self.lock().packs.values().copied().collect();
        let mut seen = HashSet::new();
        let mut objects = Vec::new();
        while !found.is_empty() {
            found.retain(|pack| seen.insert(*pack));
            let loaded: Vec<(Hash, Option<Pack>)> = stream::iter(std::mem::take(&mut found))
                .map(|hash| async move {
                    Ok::<_, Error>((hash, error::missing(self.objects.get(hash).await)?))
                })
                .buffer_unordered(PARALLELISM)
                .try_collect()
                .await?;
            for (hash, pack) in loaded.into_iter() {
                let Some(pack) = pack else { continue };
                objects.push(hash);
                found.extend(pack.packed.iter().map(|(_, pack)| *pack));
                for (_, parts) in &pack.sharded {
                    objects.extend(parts);
                }
                self.learn(hash, pack)?;
            }
        }
        Ok(objects)
    }

    fn learn(&self, pack: Hash, loaded: Pack) -> Result<()> {
        for (hash, tree) in &loaded.trees {
            check(*hash, tree)?;
        }
        let mut known = self.lock();
        for (hash, tree) in loaded.trees {
            known.packs.entry(hash).or_insert(pack);
            known.trees.entry(hash).or_insert_with(|| Arc::new(tree));
        }
        for (hash, parts) in loaded.sharded {
            known.packs.entry(hash).or_insert(pack);
            known.stored_parts.extend(parts.iter().copied());
            known.parts.entry(hash).or_insert_with(|| Arc::new(parts));
        }
        for (tree, pack) in loaded.packed {
            known.packs.entry(tree).or_insert(pack);
        }
        Ok(())
    }

    async fn load_parts(&self, hash: Hash, parts: &[Hash]) -> Result<()> {
        let loaded: Vec<Tree> = stream::iter(parts.to_vec())
            .map(|part| self.objects.get(part))
            .buffered(PARALLELISM)
            .try_collect()
            .await?;
        let mut tree = Tree::new();
        for part in loaded {
            tree.extend(part);
        }
        check(hash, &tree)?;
        self.lock()
            .trees
            .entry(hash)
            .or_insert_with(|| Arc::new(tree));
        Ok(())
    }

    pub async fn layout(&self, root: Hash, current: &Packs) -> Result<Layout> {
        {
            let known = self.lock();
            let recent = known.unpacked(root)?;
            if fits(recent.iter().map(|(_, tree)| &**tree))? {
                let packs = Packs {
                    packed: known.packed_under(root, recent.iter().map(|(_, tree)| &**tree)),
                    recent: recent
                        .into_iter()
                        .map(|(_, tree)| Tree::clone(&tree))
                        .collect(),
                    ..*current
                };
                if postcard::to_stdvec(&packs)?.len() <= RECENT_MAX {
                    return Ok((packs, Vec::new(), Vec::new()));
                }
            }
            let layout = Packer::new(&known, false).pack(root, current)?;
            if layout.0.written <= layout.0.repacked.max(REPACK_MIN) {
                return Ok(layout);
            }
        }
        self.load_all(root).await?;
        Packer::new(&self.lock(), true).pack(root, current)
    }

    async fn load_all(&self, root: Hash) -> Result<()> {
        let mut seen = HashSet::from([root]);
        let mut level = vec![root];
        while !level.is_empty() {
            let trees = try_join_all(level.iter().map(|&tree| self.get(tree))).await?;
            level = trees
                .iter()
                .flat_map(|tree| folders(tree))
                .filter(|&tree| seen.insert(tree))
                .collect();
        }
        Ok(())
    }

    pub fn saved(&self, root: Hash, new: &[Pack]) -> Result<()> {
        let mut known = self.lock();
        for pack in new {
            let hash = Objects::address(pack)?;
            for (tree, _) in &pack.trees {
                known.packs.insert(*tree, hash);
            }
            for (tree, parts) in &pack.sharded {
                known.packs.insert(*tree, hash);
                known.stored_parts.extend(parts.iter().copied());
                known.parts.insert(*tree, Arc::new(parts.clone()));
            }
        }
        let used = known.under(root);
        let Known {
            trees,
            packs,
            parts,
            stored_parts,
            ..
        } = &mut *known;
        trees.retain(|hash, _| used.contains(hash));
        packs.retain(|hash, _| used.contains(hash));
        parts.retain(|hash, _| used.contains(hash));
        *stored_parts = parts
            .values()
            .flat_map(|list| list.iter().copied())
            .collect();
        known.since = Some(SystemTime::now());
        Ok(())
    }

    pub(crate) fn since(&self) -> SystemTime {
        self.lock().since()
    }

    pub(crate) fn started(&self, at: SystemTime) {
        let mut known = self.lock();
        known.since = Some(known.since().min(at));
    }

    fn lock(&self) -> MutexGuard<'_, Known> {
        crate::sync::lock(&self.known)
    }
}

fn fits<'a>(trees: impl Iterator<Item = &'a Tree>) -> Result<bool> {
    let mut size = 0;
    for tree in trees {
        if tree.len() * ENTRY_MIN > RECENT_MAX {
            return Ok(false);
        }
        size += serialized_size(tree)?;
        if size > RECENT_MAX {
            return Ok(false);
        }
    }
    Ok(true)
}

impl Known {
    fn since(&self) -> SystemTime {
        self.since.unwrap_or(UNIX_EPOCH)
    }

    fn unpacked(&self, root: Hash) -> Result<Vec<(Hash, Arc<Tree>)>> {
        let mut found = Vec::new();
        let mut todo = vec![root];
        let mut seen = HashSet::new();
        while let Some(hash) = todo.pop() {
            if self.packs.contains_key(&hash) || !seen.insert(hash) {
                continue;
            }
            let tree = self.trees.get(&hash).ok_or_else(|| missing(hash))?.clone();
            todo.extend(folders(&tree));
            found.push((hash, tree));
        }
        Ok(found)
    }

    fn under(&self, root: Hash) -> HashSet<Hash> {
        let mut found = HashSet::new();
        let mut todo = vec![root];
        while let Some(hash) = todo.pop() {
            if found.insert(hash)
                && let Some(tree) = self.trees.get(&hash)
            {
                todo.extend(folders(tree));
            }
        }
        found
    }

    fn packed_under<'a>(
        &self,
        root: Hash,
        trees: impl Iterator<Item = &'a Tree>,
    ) -> Vec<(Hash, Hash)> {
        let pointed: HashSet<Hash> = trees.flat_map(folders).chain([root]).collect();
        pointed
            .into_iter()
            .filter_map(|tree| Some((tree, *self.packs.get(&tree)?)))
            .collect()
    }
}

fn check(hash: Hash, tree: &Tree) -> Result<()> {
    if Objects::address(tree)? != hash {
        return Err(Error::Corrupt(format!(
            "tree {hash} does not match its hash"
        )));
    }
    check_names(hash, tree)
}

fn check_names(hash: Hash, tree: &Tree) -> Result<()> {
    match tree.keys().find(|name| !valid_entry_name(name)) {
        Some(name) => Err(Error::Corrupt(format!(
            "tree {hash} has the unsafe name {name:?}"
        ))),
        None => Ok(()),
    }
}

fn folders(tree: &Tree) -> impl Iterator<Item = Hash> + '_ {
    tree.values().filter_map(|entry| match entry {
        Entry::Dir { tree } => Some(*tree),
        _ => None,
    })
}

fn missing(tree: Hash) -> Error {
    Error::Corrupt(format!("tree {tree} is in none of the commit's packs"))
}
