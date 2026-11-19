use std::sync::Arc;

use object_store::memory::InMemory;

use crate::format::lists;
use crate::format::parts::PartRef;
use crate::history::gc;
use crate::text::TextOptions;
use crate::{Doc, Id, Index, Kind, Schema};

fn page(id: u64, tag: &str) -> Doc {
    Doc::new(id).attribute("body", format!("{tag}{}", "x".repeat(4000)))
}

async fn parts(index: &Index) -> Vec<PartRef> {
    let version = index.version().await.unwrap();
    lists::all(&index.storage, &version.parts).await.unwrap()
}

async fn body(index: &Index, id: u64) -> Option<String> {
    let doc = index.get(&Id::Num(id)).await.unwrap()?;
    match doc.attributes.get("body") {
        Some(crate::Value::String(body)) => Some(body[..body.len() - 4000].to_string()),
        _ => None,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fold_rewrites_only_the_parts_its_writes_land_in() {
    let store = Arc::new(InMemory::new());
    let schema = Schema::new()
        .attribute("body", Kind::String)
        .text("body", TextOptions::default());
    let index = Index::create(store.clone(), schema).await.unwrap();
    for batch in 0..5u64 {
        let docs = (batch * 1000..(batch + 1) * 1000)
            .map(|id| page(id, "a"))
            .collect();
        index.upsert(docs).await.unwrap();
    }
    index.build().await.unwrap();
    let before = parts(&index).await;
    assert!(before.len() >= 4, "{} parts", before.len());
    assert!(before.windows(2).all(|pair| pair[0].last < pair[1].first));
    let version = index.version().await.unwrap();
    assert!(version.built.hashes.is_empty());
    assert_eq!(version.folded, 5);

    index.upsert(vec![page(10, "b")]).await.unwrap();
    index.delete(vec![Id::Num(4000)]).await.unwrap();
    index.build().await.unwrap();
    let small = index.version().await.unwrap();
    assert_eq!((small.folded, small.built.len), (5, 2));
    assert_eq!(parts(&index).await, before);

    index
        .upsert((100..1100).map(|id| page(id, "c")).collect())
        .await
        .unwrap();
    index.build().await.unwrap();
    let after = parts(&index).await;
    assert!(index.version().await.unwrap().built.hashes.is_empty());
    let changed = after.iter().filter(|part| !before.contains(part)).count();
    assert!(
        (1..=3).contains(&changed),
        "{changed} of {} parts changed",
        after.len()
    );
    assert!(after.len().abs_diff(before.len()) <= 1);
    assert_eq!(body(&index, 500).await.as_deref(), Some("c"));

    assert_eq!(body(&index, 10).await.as_deref(), Some("b"));
    assert_eq!(body(&index, 11).await.as_deref(), Some("a"));
    assert_eq!(body(&index, 4000).await, None);
    assert_eq!(index.stats().await.unwrap().rows, 4999);
    let scanned = index.scan(None, usize::MAX).await.unwrap();
    assert_eq!(scanned.len(), 4999);
    assert!(scanned.windows(2).all(|pair| pair[0].id < pair[1].id));

    let now = std::time::Duration::ZERO;
    let collected = gc::collect_index(store.clone(), now, now, false)
        .await
        .unwrap();
    assert!(collected.deleted >= 8, "{} deleted", collected.deleted);
    assert_eq!(collected.missing, 0);
    let reopened = Index::open(store, crate::MAIN).await.unwrap();
    assert_eq!(body(&reopened, 10).await.as_deref(), Some("b"));
    assert_eq!(reopened.scan(None, usize::MAX).await.unwrap().len(), 4999);
}

#[tokio::test(flavor = "multi_thread")]
async fn branches_that_folded_merge_both_ways_without_undoing_newer_writes() {
    let schema = Schema::new()
        .attribute("body", Kind::String)
        .text("body", TextOptions::default());
    let main = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    main.upsert((0..20).map(|id| page(id, "main")).collect())
        .await
        .unwrap();
    main.build().await.unwrap();
    let dev = main.fork("dev").await.unwrap();
    dev.upsert(vec![page(3, "dev"), page(30, "dev")])
        .await
        .unwrap();
    dev.delete(vec![Id::Num(5)]).await.unwrap();
    main.upsert(vec![page(4, "main2")]).await.unwrap();
    dev.build().await.unwrap();
    main.build().await.unwrap();

    assert_eq!(main.merge("dev").await.unwrap(), 3);
    assert_eq!(body(&main, 3).await.as_deref(), Some("dev"));
    assert_eq!(body(&main, 4).await.as_deref(), Some("main2"));
    assert_eq!(body(&main, 30).await.as_deref(), Some("dev"));
    assert_eq!(body(&main, 5).await, None);
    assert_eq!(body(&main, 6).await.as_deref(), Some("main"));
    assert_eq!(main.merge("dev").await.unwrap(), 0);

    dev.upsert(vec![page(3, "dev2")]).await.unwrap();
    dev.build().await.unwrap();
    main.build().await.unwrap();
    assert_eq!(dev.merge("main").await.unwrap(), 1);
    assert_eq!(body(&dev, 4).await.as_deref(), Some("main2"));
    assert_eq!(body(&dev, 3).await.as_deref(), Some("dev2"));
    assert_eq!(body(&dev, 30).await.as_deref(), Some("dev"));
    assert_eq!(main.merge("dev").await.unwrap(), 1);
    assert_eq!(body(&main, 3).await.as_deref(), Some("dev2"));
}
