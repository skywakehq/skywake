//! Changing one file in a huge folder costs about as much as in a small one.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use common::{Faulty, Op};
use skywake_core::{Data, Entry, FILE_MODE, Repo, Tree, Trees, files};

const FILES: usize = 200_000;

fn file(i: usize) -> Entry {
    Entry::File {
        size: 1,
        modified_ns: i as u64,
        mode: FILE_MODE,
        data: Data::Inline(vec![i as u8]),
    }
}

fn name(i: usize) -> String {
    format!("file-{i:07}.txt")
}

#[tokio::test]
async fn one_change_in_a_huge_folder_uploads_little() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let mut folder: Tree = (0..FILES).map(|i| (name(i), file(i))).collect();
    let hash = claim.trees.add(folder.clone()).unwrap();
    let root = Tree::from([("big".to_string(), Entry::Dir { tree: hash })]);
    let root = claim.trees.add(root).unwrap();
    store.reset_counts();
    repo.save(&mut claim, root, Some("all")).await.unwrap();
    let first = store.0.put_bytes.load(Ordering::Relaxed);

    for round in 0..3 {
        folder.insert(name(FILES / 2 + round), file(round));
        folder.insert(format!("new-{round}"), file(round));
        let hash = claim.trees.add(folder.clone()).unwrap();
        let root = Tree::from([("big".to_string(), Entry::Dir { tree: hash })]);
        let root = claim.trees.add(root).unwrap();
        store.reset_counts();
        repo.save(&mut claim, root, Some("one more")).await.unwrap();
        let bytes = store.0.put_bytes.load(Ordering::Relaxed);
        assert!(
            bytes < first / 20 && bytes < 200_000,
            "a save of two changed files uploaded {bytes} bytes; the first save {first}"
        );
    }
    let packs = repo.log("main").await.unwrap()[0].1.packs.clone();
    assert_eq!(packs.repacked, 0, "no full repack: {packs:?}");

    let trees = Trees::new(repo.objects().clone(), &packs).unwrap();
    let root = trees
        .get(repo.log("main").await.unwrap()[0].1.tree)
        .await
        .unwrap();
    let Some(Entry::Dir { tree }) = root.get("big") else {
        panic!("no folder")
    };
    let read = trees.get(*tree).await.unwrap();
    assert_eq!(*read, folder);
}

#[tokio::test]
async fn finding_one_file_in_a_huge_folder_reads_a_few_parts() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let folder: Tree = (0..FILES).map(|i| (name(i), file(i))).collect();
    let hash = claim.trees.add(folder).unwrap();
    let root = Tree::from([("big".to_string(), Entry::Dir { tree: hash })]);
    let root = claim.trees.add(root).unwrap();
    repo.save(&mut claim, root, Some("all")).await.unwrap();

    let gets = Arc::new(AtomicU64::new(0));
    let counted = gets.clone();
    store.on(Op::Get, "objects/", usize::MAX, move || {
        counted.fetch_add(1, Ordering::Relaxed);
        Box::pin(async {})
    });
    let (root, trees) = repo.head_tree("main").await.unwrap();
    for i in [0, 1, FILES / 3, FILES - 1] {
        let found = files::find(&trees, root, &format!("big/{}", name(i)))
            .await
            .unwrap();
        assert_eq!(found, Some(file(i)));
    }
    for missing in ["a", "file-0000000.txu", "zzz"] {
        let found = files::find(&trees, root, &format!("big/{missing}"))
            .await
            .unwrap();
        assert_eq!(found, None, "{missing}");
    }
    let read = gets.load(Ordering::Relaxed);
    assert!(read < 60, "{read} objects read");
}

#[tokio::test]
async fn a_page_of_a_huge_folder_reads_a_few_parts() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let folder: Tree = (0..FILES).map(|i| (name(i), file(i))).collect();
    let hash = claim.trees.add(folder.clone()).unwrap();
    let root = Tree::from([("big".to_string(), Entry::Dir { tree: hash })]);
    let root = claim.trees.add(root).unwrap();
    repo.save(&mut claim, root, Some("all")).await.unwrap();

    let gets = Arc::new(AtomicU64::new(0));
    let counted = gets.clone();
    store.on(Op::Get, "objects/", usize::MAX, move || {
        counted.fetch_add(1, Ordering::Relaxed);
        Box::pin(async {})
    });
    let mut after: Option<String> = None;
    let mut seen = 0;
    for start in [None, Some(name(FILES / 2)), Some(name(FILES - 3))] {
        after = start.or(after);
        let (_, page) = repo
            .list_page("main", None, "big", after.as_deref(), 1000)
            .await
            .unwrap();
        let first = after
            .as_ref()
            .map_or(0, |name| name[5..12].parse::<usize>().unwrap() + 1);
        let expected: Vec<String> = (first..(first + 1000).min(FILES)).map(name).collect();
        let names: Vec<String> = page.iter().map(|(name, _)| name.clone()).collect();
        assert_eq!(names, expected);
        seen += page.len();
        after = page.last().map(|(name, _)| name.clone());
    }
    assert_eq!(seen, 2002);
    let read = gets.load(Ordering::Relaxed);
    assert!(read < 60, "{read} objects read");
}
