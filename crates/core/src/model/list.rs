//! A long list kept as a tree of small nodes. Nodes end where an entry's hash
//! says, so equal lists make equal trees, and a change rewrites only the nodes
//! on its way to the root. Short lists stay inline in whatever holds them.

use std::future::Future;
use std::sync::Arc;

use futures::future::try_join_all;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::{Hash, Result};

pub const FANOUT: u32 = 1024;

const NODE_MAX: usize = 256 << 10;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum List<T> {
    Inline(Vec<T>),
    Tree { root: Hash, len: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Node<T> {
    Leaf(Vec<T>),
    Branch(Vec<Child>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Child {
    pub hash: Hash,
    pub len: u64,
}

pub struct Built<T> {
    pub list: List<T>,
    pub nodes: Vec<(Hash, Vec<u8>)>,
}

pub struct Walked<T> {
    pub nodes: Vec<Hash>,
    pub entries: Vec<T>,
}

impl<T> Default for List<T> {
    fn default() -> Self {
        Self::Inline(Vec::new())
    }
}

impl<T> List<T>
where
    T: Clone + Serialize + DeserializeOwned,
{
    pub fn build(entries: Vec<T>, inline: usize) -> Result<Built<T>> {
        if entries.len() <= inline {
            let list = Self::Inline(entries);
            return Ok(Built {
                list,
                nodes: Vec::new(),
            });
        }
        let len = entries.len() as u64;
        let mut nodes = Vec::new();
        let mut level = Vec::new();
        for leaf in cut(entries)? {
            level.push(store(Node::Leaf(leaf.entries), leaf.len, &mut nodes)?);
        }
        while level.len() > 1 {
            let mut up = Vec::new();
            for branch in cut(level)? {
                let len = branch.entries.iter().map(|child| child.len).sum();
                up.push(store(Node::<T>::Branch(branch.entries), len, &mut nodes)?);
            }
            level = up;
        }
        let root = level[0].hash;
        Ok(Built {
            list: Self::Tree { root, len },
            nodes,
        })
    }

    pub fn len(&self) -> u64 {
        match self {
            Self::Inline(entries) => entries.len() as u64,
            Self::Tree { len, .. } => *len,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn root(&self) -> Option<Hash> {
        match self {
            Self::Inline(_) => None,
            Self::Tree { root, .. } => Some(*root),
        }
    }

    /// The entries at `wanted`, in that order, reading one level of the tree at a time.
    /// Every position must be below `len`.
    pub async fn get_many<E, F, Fut>(&self, wanted: &[u64], fetch: F) -> Result<Vec<T>, E>
    where
        F: Fn(Hash) -> Fut,
        Fut: Future<Output = Result<Arc<Node<T>>, E>>,
    {
        let root = match self {
            Self::Inline(entries) => {
                return Ok(wanted
                    .iter()
                    .map(|&i| entries[i as usize].clone())
                    .collect());
            }
            Self::Tree { root, .. } => *root,
        };
        let mut asks: Asks = wanted.iter().copied().zip(0..).collect();
        asks.sort_unstable();
        let mut found: Vec<Option<T>> = vec![None; wanted.len()];
        let mut frontier = vec![(root, 0, asks)];
        while !frontier.is_empty() {
            let nodes = try_join_all(frontier.iter().map(|(hash, ..)| fetch(*hash))).await?;
            let mut next = Vec::new();
            for ((_, start, asks), node) in frontier.into_iter().zip(nodes) {
                match &*node {
                    Node::Leaf(entries) => {
                        for (at, slot) in asks {
                            found[slot] = Some(entries[(at - start) as usize].clone());
                        }
                    }
                    Node::Branch(children) => descend(children, start, asks, &mut next),
                }
            }
            frontier = next;
        }
        Ok(found.into_iter().flatten().collect())
    }

    pub async fn all<E, F, Fut>(&self, fetch: F) -> Result<Vec<T>, E>
    where
        F: Fn(Hash) -> Fut,
        Fut: Future<Output = Result<Arc<Node<T>>, E>>,
    {
        Ok(self.walk(fetch).await?.entries)
    }

    pub async fn walk<E, F, Fut>(&self, fetch: F) -> Result<Walked<T>, E>
    where
        F: Fn(Hash) -> Fut,
        Fut: Future<Output = Result<Arc<Node<T>>, E>>,
    {
        let mut walked = Walked {
            nodes: Vec::new(),
            entries: Vec::new(),
        };
        let mut level = match self {
            Self::Inline(entries) => {
                walked.entries = entries.clone();
                return Ok(walked);
            }
            Self::Tree { root, .. } => vec![*root],
        };
        while !level.is_empty() {
            walked.nodes.extend(level.iter().copied());
            let nodes = try_join_all(level.iter().map(|hash| fetch(*hash))).await?;
            level = Vec::new();
            for node in nodes {
                match &*node {
                    Node::Leaf(entries) => walked.entries.extend(entries.iter().cloned()),
                    Node::Branch(children) => level.extend(children.iter().map(|c| c.hash)),
                }
            }
        }
        Ok(walked)
    }
}

type Asks = Vec<(u64, usize)>;

fn descend(children: &[Child], start: u64, asks: Asks, next: &mut Vec<(Hash, u64, Asks)>) {
    let mut asks = asks.into_iter().peekable();
    let mut offset = start;
    for child in children {
        let end = offset + child.len;
        let mut mine = Vec::new();
        while let Some(&(at, slot)) = asks.peek()
            && at < end
        {
            mine.push((at, slot));
            asks.next();
        }
        if !mine.is_empty() {
            next.push((child.hash, offset, mine));
        }
        offset = end;
    }
}

struct Run<T> {
    entries: Vec<T>,
    len: u64,
}

fn cut<T: Serialize>(entries: Vec<T>) -> Result<Vec<Run<T>>> {
    let mut runs = Vec::new();
    let mut run = Vec::new();
    let mut bytes = 0;
    for entry in entries {
        let encoded = postcard::to_stdvec(&entry)?;
        bytes += encoded.len();
        run.push(entry);
        if ends(&encoded) || bytes >= NODE_MAX {
            let len = run.len() as u64;
            runs.push(Run {
                entries: std::mem::take(&mut run),
                len,
            });
            bytes = 0;
        }
    }
    if !run.is_empty() {
        let len = run.len() as u64;
        runs.push(Run { entries: run, len });
    }
    Ok(runs)
}

fn ends(encoded: &[u8]) -> bool {
    let hash = Hash::of(encoded);
    let head = u32::from_le_bytes(hash.as_bytes()[..4].try_into().expect("four bytes"));
    head < u32::MAX / FANOUT
}

fn store<T: Serialize>(node: Node<T>, len: u64, nodes: &mut Vec<(Hash, Vec<u8>)>) -> Result<Child> {
    let bytes = postcard::to_stdvec(&node)?;
    let hash = Hash::of(&bytes);
    nodes.push((hash, bytes));
    Ok(Child { hash, len })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::convert::Infallible;

    use super::*;

    fn hashes(n: u32) -> Vec<Hash> {
        (0..n).map(|i| Hash::of(&i.to_le_bytes())).collect()
    }

    fn stored(built: &Built<Hash>) -> HashMap<Hash, Arc<Node<Hash>>> {
        (built.nodes.iter())
            .map(|(hash, bytes)| (*hash, Arc::new(postcard::from_bytes(bytes).unwrap())))
            .collect()
    }

    async fn read(built: &Built<Hash>, wanted: &[u64]) -> Vec<Hash> {
        let nodes = stored(built);
        let fetch = |hash| {
            let node = nodes[&hash].clone();
            async move { Ok::<_, Infallible>(node) }
        };
        built.list.get_many(wanted, fetch).await.unwrap()
    }

    #[test]
    fn a_short_list_stays_inline() {
        let built = List::build(hashes(10), 16).unwrap();
        assert_eq!(built.list, List::Inline(hashes(10)));
        assert!(built.nodes.is_empty());
    }

    #[tokio::test]
    async fn any_entry_of_a_long_list_comes_back() {
        let all = hashes(50_000);
        let built = List::build(all.clone(), 16).unwrap();
        assert_eq!(built.list.len(), 50_000);
        assert!(built.list.root().is_some());
        let wanted = [49_999, 0, 31_337, 1024, 1023, 31_337];
        let expected: Vec<Hash> = wanted.iter().map(|&i| all[i as usize]).collect();
        assert_eq!(read(&built, &wanted).await, expected);
        let nodes = stored(&built);
        let fetch = |hash| {
            let node = nodes[&hash].clone();
            async move { Ok::<_, Infallible>(node) }
        };
        let walked = built.list.walk(fetch).await.unwrap();
        assert_eq!(walked.entries, all);
        assert_eq!(walked.nodes.len(), built.nodes.len());
    }

    #[test]
    fn equal_lists_make_equal_trees() {
        let a = List::build(hashes(20_000), 16).unwrap();
        let b = List::build(hashes(20_000), 16).unwrap();
        assert_eq!(a.list, b.list);
    }

    #[test]
    fn changing_one_entry_rewrites_only_its_path() {
        let mut all = hashes(200_000);
        let before = List::build(all.clone(), 16).unwrap();
        all[123_456] = Hash::of(b"changed");
        let after = List::build(all, 16).unwrap();
        let old: std::collections::HashSet<Hash> = before.nodes.iter().map(|(h, _)| *h).collect();
        let new = after
            .nodes
            .iter()
            .filter(|(hash, _)| !old.contains(hash))
            .count();
        assert!(before.nodes.len() > 100);
        assert!(new <= 6, "{new} new nodes of {}", after.nodes.len());
    }

    #[test]
    fn nodes_stay_small() {
        let built = List::build(hashes(300_000), 16).unwrap();
        let largest = built
            .nodes
            .iter()
            .map(|(_, bytes)| bytes.len())
            .max()
            .unwrap();
        assert!(largest <= NODE_MAX + 64, "{largest}");
    }
}
