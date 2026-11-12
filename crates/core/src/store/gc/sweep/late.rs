//! What a sweeping worker marks itself: data that commits found during the sweep use.

use std::collections::{HashMap, HashSet};

use super::super::run::Shelf;
use super::super::slices::{SLICES, contains, hashes, slice_of};
use super::super::walk::Sink;
use crate::model::Bundled;
use crate::store::bundles::{MOVES_MAX, exists};
use crate::{Error, Hash, Objects, Result};

const CACHED: usize = 256;

pub(in super::super) struct Late<'a> {
    shelf: &'a Shelf<'a>,
    slices: usize,
    shared: HashMap<usize, Vec<Hash>>,
    pub(super) names: HashSet<Hash>,
    pub(super) chunks: HashSet<Hash>,
    named: HashSet<(Hash, u32)>,
    unresolved: Vec<Bundled>,
    pub(super) live: HashMap<Hash, HashMap<u32, Bundled>>,
    pub(super) missing: u64,
}

impl<'a> Late<'a> {
    pub(super) fn new(shelf: &'a Shelf<'a>, slices: usize) -> Self {
        Self {
            shelf,
            slices,
            shared: HashMap::new(),
            names: HashSet::new(),
            chunks: HashSet::new(),
            named: HashSet::new(),
            unresolved: Vec::new(),
            live: HashMap::new(),
            missing: 0,
        }
    }

    async fn published(&mut self, hash: Hash) -> Result<bool> {
        let work = slice_of(hash) / (SLICES / self.slices);
        if !self.shared.contains_key(&work) {
            if self.shared.len() >= CACHED {
                self.shared.clear();
            }
            let names = hashes(&self.shelf.get(&format!("names-{work}")).await?);
            self.shared.insert(work, names);
        }
        Ok(contains(&self.shared[&work], hash))
    }

    pub(super) async fn resolve(&mut self, objects: &Objects) -> Result<()> {
        let mut present = HashMap::new();
        for mut at in std::mem::take(&mut self.unresolved) {
            for _ in 0..MOVES_MAX {
                let here = match present.get(&at.bundle) {
                    Some(&here) => here,
                    None => {
                        let here = exists(objects, at.bundle).await?;
                        present.insert(at.bundle, here);
                        here
                    }
                };
                if here {
                    self.keep(at);
                    break;
                }
                at = match objects.moved_to(&at).await {
                    Ok(to) => {
                        self.names.insert(at.bundle);
                        to
                    }
                    // Not there and never moved: written just now, so it stays.
                    Err(Error::Store(object_store::Error::NotFound { .. })) => {
                        self.keep(at);
                        break;
                    }
                    Err(Error::Corrupt(_)) => {
                        self.missing += 1;
                        break;
                    }
                    Err(error) => return Err(error),
                };
            }
        }
        Ok(())
    }

    fn keep(&mut self, at: Bundled) {
        self.live
            .entry(at.bundle)
            .or_default()
            .insert(at.offset, at);
    }
}

impl Sink for Late<'_> {
    async fn seen(&mut self, hash: Hash) -> Result<bool> {
        Ok(self.names.contains(&hash) || self.published(hash).await?)
    }

    fn mark(&mut self, hash: Hash) -> Result<()> {
        self.names.insert(hash);
        Ok(())
    }

    fn chunk(&mut self, hash: Hash) -> Result<()> {
        self.chunks.insert(hash);
        Ok(())
    }

    fn file(&mut self, file: Bundled) -> Result<()> {
        if self.named.insert((file.bundle, file.offset)) {
            self.unresolved.push(file);
        }
        Ok(())
    }

    fn missing(&mut self) {
        self.missing += 1;
    }
}
