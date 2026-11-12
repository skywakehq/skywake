//! Deciding which trees go into which pack on a save.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use postcard::experimental::serialized_size;

use super::{ENTRY_MIN, Known, Layout, folders, missing};
use crate::model::{Pack, Packs};
use crate::{Hash, Objects, Result, Tree};

const PACK_MAX: usize = 1024 * 1024;

const SPLIT_MIN: usize = 256 * 1024;

const PART_MAX: usize = 256 * 1024;

struct Group {
    trees: Vec<(Hash, Arc<Tree>)>,
    size: usize,
}

pub(super) struct Packer<'a> {
    known: &'a Known,
    all: bool,
    new: Vec<Pack>,
    placed: HashMap<Hash, Hash>,
    split: HashMap<Hash, Arc<Vec<Hash>>>,
    new_parts: Vec<Tree>,
    new_part_hashes: HashSet<Hash>,
}

impl<'a> Packer<'a> {
    pub(super) fn new(known: &'a Known, all: bool) -> Self {
        Self {
            known,
            all,
            new: Vec::new(),
            placed: HashMap::new(),
            split: HashMap::new(),
            new_parts: Vec::new(),
            new_part_hashes: HashSet::new(),
        }
    }

    pub(super) fn pack(mut self, root: Hash, current: &Packs) -> Result<Layout> {
        let top = self.carve(root)?;
        let pack = self.finish(top)?;
        let mut bytes = 0;
        for pack in &self.new {
            bytes += serialized_size(pack)? as u64;
        }
        let (written, repacked) = match self.all {
            true => (0, bytes),
            false => (current.written + bytes, current.repacked),
        };
        let packs = Packs {
            recent: Vec::new(),
            packed: vec![(root, pack)],
            written,
            repacked,
        };
        Ok((packs, self.new, self.new_parts))
    }

    fn carve(&mut self, hash: Hash) -> Result<Group> {
        let tree = self.known.trees[&hash].clone();
        let mut children = Vec::new();
        for child in folders(&tree) {
            if (self.all || !self.known.packs.contains_key(&child))
                && !self.placed.contains_key(&child)
            {
                children.push(self.carve(child)?);
            }
        }
        children.sort_by_key(|group| group.size);
        let mut size = self.size_in_pack(hash, &tree)?
            + children.iter().map(|group| group.size).sum::<usize>();
        while size > PACK_MAX
            && let Some(largest) = children.pop()
        {
            size -= largest.size;
            self.finish(largest)?;
        }
        let mut trees = vec![(hash, tree)];
        trees.extend(children.into_iter().flat_map(|group| group.trees));
        Ok(Group { trees, size })
    }

    fn size_in_pack(&mut self, hash: Hash, tree: &Tree) -> Result<usize> {
        if let Some(parts) = self.known.parts.get(&hash) {
            self.split.insert(hash, parts.clone());
            return Ok(32 * parts.len());
        }
        if tree.len() * ENTRY_MIN <= SPLIT_MIN {
            let size = serialized_size(tree)?;
            if size <= SPLIT_MIN {
                return Ok(size);
            }
        }
        let mut hashes = Vec::new();
        for part in split(tree)? {
            let part_hash = Objects::address(&part)?;
            hashes.push(part_hash);
            if !self.known.stored_parts.contains(&part_hash)
                && self.new_part_hashes.insert(part_hash)
            {
                self.new_parts.push(part);
            }
        }
        let size = 32 * hashes.len();
        self.split.insert(hash, Arc::new(hashes));
        Ok(size)
    }

    fn finish(&mut self, group: Group) -> Result<Hash> {
        let inside: HashMap<Hash, Arc<Tree>> = group.trees.into_iter().collect();
        let mut packed = HashMap::new();
        for child in inside.values().flat_map(|tree| folders(tree)) {
            if !inside.contains_key(&child) {
                let pack = self.placed.get(&child).or(self.known.packs.get(&child));
                packed.insert(child, *pack.ok_or_else(|| missing(child))?);
            }
        }
        let mut pack = Pack {
            packed: packed.into_iter().collect(),
            ..Pack::default()
        };
        for (hash, tree) in &inside {
            match self.split.get(hash) {
                Some(parts) => pack.sharded.push((*hash, Vec::clone(parts))),
                None => pack.trees.push((*hash, Tree::clone(tree))),
            }
        }
        let hash = Objects::address(&pack)?;
        self.placed.extend(inside.keys().map(|tree| (*tree, hash)));
        self.new.push(pack);
        Ok(hash)
    }
}

fn split(tree: &Tree) -> Result<Vec<Tree>> {
    let mut parts = Vec::new();
    let mut part = Tree::new();
    let mut size = 0;
    for (name, entry) in tree {
        size += serialized_size(&(name, entry))?;
        part.insert(name.clone(), entry.clone());
        if blake3::hash(name.as_bytes()).as_bytes()[0] == 0 || size >= PART_MAX {
            parts.push(std::mem::take(&mut part));
            size = 0;
        }
    }
    if !part.is_empty() {
        parts.push(part);
    }
    Ok(parts)
}
