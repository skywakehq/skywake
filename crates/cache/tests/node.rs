//! Machines reading chunks through a cache node.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use object_store::ObjectStoreExt;
use object_store::memory::InMemory;
use object_store::path::Path;
use skywake_cache::Node;
use skywake_core::cache::{CacheNodes, ChunkCache};
use skywake_core::{Hash, Objects};
use tempfile::{TempDir, tempdir};

use common::{TOKEN, listen, serve};

async fn bucket() -> (Arc<InMemory>, Objects, Vec<u8>, Hash) {
    let store = Arc::new(InMemory::new());
    let objects = Objects::new(store.clone());
    let data: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
    let hash = objects.put_chunk(data.clone()).await.unwrap();
    (store, objects, data, hash)
}

fn cache_node(objects: &Objects, dir: &TempDir) -> Node {
    let cache = ChunkCache::new(dir.path().into(), u64::MAX).unwrap();
    Node::new(Arc::new(cache), objects.clone(), Some(TOKEN.into()))
}

async fn node(objects: &Objects, dir: &TempDir) -> String {
    serve(cache_node(objects, dir)).await
}

fn machine(dir: &TempDir, nodes: Vec<String>) -> ChunkCache {
    ChunkCache::new(dir.path().into(), u64::MAX)
        .unwrap()
        .with_nodes(CacheNodes::new(nodes, Some(TOKEN.into())))
}

async fn status(url: &str, hash: Hash, token: Option<&str>) -> u16 {
    let mut request = reqwest::Client::new().get(format!("{url}/chunks/{hash}"));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request.send().await.unwrap().status().as_u16()
}

#[tokio::test]
async fn machines_read_through_the_node_which_keeps_what_it_fetched() {
    let (store, objects, data, hash) = bucket().await;
    let node_dir = tempdir().unwrap();
    let url = node(&objects, &node_dir).await;
    let first = tempdir().unwrap();
    assert_eq!(
        machine(&first, vec![url.clone()])
            .get(&objects, hash)
            .await
            .unwrap(),
        data
    );

    store
        .delete(&Path::from(format!("chunks/{hash}")))
        .await
        .unwrap();
    let second = tempdir().unwrap();
    assert_eq!(
        machine(&second, vec![url])
            .get(&objects, hash)
            .await
            .unwrap(),
        data
    );
}

#[tokio::test]
async fn a_dead_node_is_skipped() {
    let (_, objects, data, hash) = bucket().await;
    let dir = tempdir().unwrap();
    let dead = vec!["http://127.0.0.1:9".to_string()];
    assert_eq!(machine(&dir, dead).get(&objects, hash).await.unwrap(), data);
}

#[tokio::test]
async fn a_node_that_never_answers_costs_under_a_second() {
    let (_, objects, data, hash) = bucket().await;
    let (listener, url) = listen().await;
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            held.push(socket);
        }
    });
    let dir = tempdir().unwrap();
    let started = Instant::now();
    assert_eq!(
        machine(&dir, vec![url]).get(&objects, hash).await.unwrap(),
        data
    );
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[tokio::test]
async fn wrong_bytes_from_a_node_are_refused() {
    let (_, objects, data, hash) = bucket().await;
    let node_dir = tempdir().unwrap();
    std::fs::write(node_dir.path().join(hash.to_string()), b"not the chunk").unwrap();
    let url = node(&objects, &node_dir).await;
    let dir = tempdir().unwrap();
    assert_eq!(
        machine(&dir, vec![url]).get(&objects, hash).await.unwrap(),
        data
    );
}

#[tokio::test]
async fn the_node_refuses_a_missing_or_wrong_token() {
    let (_, objects, _, hash) = bucket().await;
    let node_dir = tempdir().unwrap();
    let url = node(&objects, &node_dir).await;
    assert_eq!(status(&url, hash, None).await, 401);
    assert_eq!(status(&url, hash, Some("test-tokem")).await, 401);
    assert_eq!(status(&url, hash, Some("")).await, 401);
    assert_eq!(status(&url, hash, Some(TOKEN)).await, 200);
    assert_eq!(std::fs::read_dir(node_dir.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn a_missing_chunk_is_not_asked_from_the_bucket_again_soon() {
    let (store, objects, _, _) = bucket().await;
    let node_dir = tempdir().unwrap();
    let url = node(&objects, &node_dir).await;
    let data = b"written after the node looked".to_vec();
    let hash = Hash::of(&data);
    assert_eq!(status(&url, hash, Some(TOKEN)).await, 404);
    objects.put_chunk(data).await.unwrap();
    assert!(
        store
            .head(&Path::from(format!("chunks/{hash}")))
            .await
            .is_ok()
    );
    assert_eq!(status(&url, hash, Some(TOKEN)).await, 404);
}

fn files(dir: &TempDir) -> Vec<std::ffi::OsString> {
    let names = std::fs::read_dir(dir.path()).unwrap();
    names.map(|entry| entry.unwrap().file_name()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn index_blobs_are_read_through_the_node_from_the_index_folder() {
    use object_store::ObjectStore;
    use object_store::prefix::PrefixStore;
    use skywake_index::{Doc, Metric, Options, Query, Schema, Shards, shard_folder};

    let bucket = Arc::new(InMemory::new());
    let folder = "acme/indexes/ix_1";
    let stores: Vec<Arc<dyn ObjectStore>> = (0..2)
        .map(|n| {
            let path = format!("{folder}/{}", shard_folder(n));
            Arc::new(PrefixStore::new(bucket.clone(), path)) as Arc<dyn ObjectStore>
        })
        .collect();
    let schema = Schema::new().vector("v", 8, Metric::Euclidean);
    let options = Options {
        cluster_rows: 50,
        ..Options::default()
    };
    let index = Shards::create(stores.clone(), schema, options)
        .await
        .unwrap();
    let docs = (0..600u64).map(|id| Doc::new(id).vector("v", vec![(id % 37) as f32; 8]));
    index.upsert(docs.collect()).await.unwrap();
    index.build().await.unwrap();
    let query = Query::new("v", vec![3.0; 8], 10);
    let expected = index.query(&query).await.unwrap();

    let node_dir = tempdir().unwrap();
    let url = node(&Objects::new(bucket.clone()), &node_dir).await;
    let machine_dir = tempdir().unwrap();
    let options = Options {
        disk: Some(Arc::new(machine(&machine_dir, vec![url]))),
        shared: Some(folder.into()),
        ..Options::default()
    };
    for _ in 0..200 {
        let opened = Shards::open(stores.clone(), "main", options.clone())
            .await
            .unwrap();
        assert_eq!(opened.query(&query).await.unwrap(), expected);
        let (node_has, machine_has) = (files(&node_dir), files(&machine_dir));
        let blobs_too = machine_has.len() > 4;
        if blobs_too && machine_has.iter().all(|name| node_has.contains(name)) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the machine read blobs the node never served");
}

async fn node_with_ranges(objects: &Objects, dir: &TempDir) -> String {
    let node = cache_node(objects, dir)
        .with_ranges(dir.path().join("ranges"))
        .unwrap();
    serve(node).await
}

#[tokio::test]
async fn a_small_miss_fetches_only_its_range_and_checks_it() {
    let (_store, objects, data, hash) = bucket().await;
    let node_dir = tempdir().unwrap();
    let url = node_with_ranges(&objects, &node_dir).await;
    let here = tempdir().unwrap();
    let cache = machine(&here, vec![url]);

    let part = cache
        .read_slice(&objects, hash, 70_000, 4096)
        .await
        .unwrap();
    assert_eq!(part, data[70_000..74_096]);
    assert!(!cache.has(hash));

    std::fs::write(
        node_dir.path().join("ranges").join(hash.to_string()),
        vec![7; 20_000],
    )
    .unwrap();
    assert!(
        cache
            .read_slice(&objects, hash, 70_000, 4096)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn small_files_come_through_the_node_a_bundle_at_a_time_and_stay_there() {
    let store = Arc::new(InMemory::new());
    let objects = Objects::new(store.clone());
    let bundler = skywake_core::Bundler::new(&objects);
    let mut files = Vec::new();
    for i in 0..50u32 {
        let data: Vec<u8> = (0..20_000u32).map(|j| ((i * 31 + j) % 251) as u8).collect();
        let skywake_core::Data::Bundled(bundled) = bundler.add(data.clone()).await.unwrap() else {
            panic!("a small file goes in a bundle")
        };
        files.push((bundled, data));
    }
    bundler.finish().await.unwrap();
    let wanted: Vec<_> = files.iter().map(|(bundled, _)| *bundled).collect();

    let node_dir = tempdir().unwrap();
    let url = node(&objects, &node_dir).await;
    let first = tempdir().unwrap();
    let first = machine(&first, vec![url.clone()]);
    first.fetch_bundled(&objects, wanted.clone()).await;
    for (bundled, data) in &files {
        assert_eq!(
            &first.get(&objects, bundled.chunk.hash).await.unwrap(),
            data
        );
    }

    store
        .delete(&Path::from(format!("bundles/{}", wanted[0].bundle)))
        .await
        .unwrap();
    let second = tempdir().unwrap();
    let second = machine(&second, vec![url]);
    second
        .fetch_bundled(&Objects::new(store.clone()), wanted)
        .await;
    for (bundled, data) in &files {
        assert!(second.has(bundled.chunk.hash));
        assert_eq!(
            &second.get(&objects, bundled.chunk.hash).await.unwrap(),
            data
        );
    }
}
