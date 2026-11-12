//! A synthetic filesystem written straight to the store: real trees, commits and chunk objects with tiny bodies.

use anyhow::Result;
use futures::{StreamExt, TryStreamExt, stream};
use skywake_core::{Chunk, Content, Data, Edit, Entry, FILE_MODE, Hash, Repo, Tree, Trees};

const BATCH: u64 = 10_000;
const PUTS_AT_ONCE: usize = 64;

pub(crate) const BRANCH: &str = "main";

pub(crate) struct Made {
    pub files: u64,
    pub folders: u64,
    pub deep: String,
    pub edited: String,
}

pub(crate) async fn make(
    repo: &Repo,
    files: u64,
    per_folder: usize,
    history: usize,
) -> Result<Made> {
    repo.create_branch(BRANCH, None).await?;
    let mut claim = repo.claim(BRANCH).await?;
    let mut folders = Folders::new(&claim.trees, per_folder);
    for start in (0..files).step_by(BATCH as usize) {
        let end = (start + BATCH).min(files);
        let chunks: Vec<Chunk> = stream::iter(start..end)
            .map(|i| put_file(repo, i))
            .buffered(PUTS_AT_ONCE)
            .try_collect()
            .await?;
        for chunk in chunks {
            folders.add_file(chunk)?;
        }
    }
    let made = folders.made;
    let root = folders.finish()?;
    repo.save(&mut claim, root, Some("synthetic")).await?;

    let deep = deepest_file(&claim.trees, root, End::Last).await?;
    let edited = deepest_file(&claim.trees, root, End::First).await?;
    for change in 0..history {
        let edit = Edit {
            path: edited.clone(),
            content: Content::Bytes(format!("change {change}").into_bytes()),
            mode: FILE_MODE,
        };
        repo.commit_files(BRANCH, "change", None, vec![edit])
            .await?;
    }
    Ok(Made {
        files,
        folders: made,
        deep,
        edited,
    })
}

async fn put_file(repo: &Repo, i: u64) -> Result<Chunk> {
    let raw = format!("file {i}").into_bytes();
    let size = raw.len() as u32;
    let hash = repo.objects().put_chunk(raw).await?;
    Ok(Chunk { hash, size })
}

enum End {
    First,
    Last,
}

async fn deepest_file(trees: &Trees, root: Hash, end: End) -> Result<String> {
    let mut path = Vec::new();
    let mut tree = root;
    loop {
        let folder = trees.get(tree).await?;
        let found = match end {
            End::First => folder.iter().next(),
            End::Last => folder.iter().next_back(),
        };
        let Some((name, entry)) = found else {
            return Ok(path.join("/"));
        };
        path.push(name.clone());
        match entry {
            Entry::Dir { tree: inner } => tree = *inner,
            _ => return Ok(path.join("/")),
        }
    }
}

struct Folders<'a> {
    trees: &'a Trees,
    per_folder: usize,
    levels: Vec<Tree>,
    made: u64,
}

impl<'a> Folders<'a> {
    fn new(trees: &'a Trees, per_folder: usize) -> Self {
        Self {
            trees,
            per_folder,
            levels: Vec::new(),
            made: 0,
        }
    }

    fn add_file(&mut self, chunk: Chunk) -> Result<()> {
        let entry = Entry::File {
            size: u64::from(chunk.size),
            modified_ns: 0,
            mode: FILE_MODE,
            data: Data::Chunks(vec![chunk]),
        };
        let name = format!("f{:05}", self.open(0).len());
        self.add(0, name, entry)
    }

    fn add(&mut self, level: usize, name: String, entry: Entry) -> Result<()> {
        self.open(level).insert(name, entry);
        if self.levels[level].len() == self.per_folder {
            self.close(level)?;
        }
        Ok(())
    }

    fn open(&mut self, level: usize) -> &mut Tree {
        if self.levels.len() == level {
            self.levels.push(Tree::new());
        }
        &mut self.levels[level]
    }

    fn close(&mut self, level: usize) -> Result<()> {
        let tree = std::mem::take(&mut self.levels[level]);
        let hash = self.trees.add(tree)?;
        self.made += 1;
        let name = format!("d{:05}", self.open(level + 1).len());
        self.add(level + 1, name, Entry::Dir { tree: hash })
    }

    fn finish(mut self) -> Result<Hash> {
        let mut level = 0;
        while level + 1 < self.levels.len() {
            if !self.levels[level].is_empty() {
                self.close(level)?;
            }
            level += 1;
        }
        let root = self.levels.pop().unwrap_or_default();
        Ok(self.trees.add(root)?)
    }
}
