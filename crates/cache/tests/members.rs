//! Servers that join and leave on their own, through their records in the bucket.

mod common;

use std::sync::Arc;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::memory::InMemory;
use object_store::path::Path;
use skywake_cache::Node;
use skywake_core::Objects;
use skywake_core::cache::{ChunkCache, Listing, LogRecord, Members, WriteLog};
use tempfile::{TempDir, tempdir};
use tokio::sync::oneshot;

use common::{TOKEN, listen};

struct Server {
    url: String,
    stop: oneshot::Sender<()>,
    done: tokio::task::JoinHandle<std::io::Result<()>>,
    _dir: TempDir,
}

async fn join(store: &Arc<dyn ObjectStore>, zone: &str) -> Server {
    let dir = tempdir().unwrap();
    let cache = ChunkCache::new(dir.path().join("chunks"), u64::MAX).unwrap();
    let (listener, url) = listen().await;
    let node = Node::new(
        Arc::new(cache),
        Objects::new(store.clone()),
        Some(TOKEN.into()),
    )
    .with_log(dir.path().join("log"), zone.into())
    .unwrap()
    .with_registration(url.clone())
    .await
    .unwrap();
    let (stop, stopped) = oneshot::channel();
    let done = tokio::spawn(skywake_cache::serve_until(listener, node, async {
        let _ = stopped.await;
    }));
    Server {
        url,
        stop,
        done,
        _dir: dir,
    }
}

async fn records(store: &Arc<dyn ObjectStore>) -> usize {
    use futures::TryStreamExt;
    let found: Vec<_> = store
        .list(Some(&Path::from("members")))
        .try_collect()
        .await
        .unwrap();
    found.len()
}

fn only(url: &str) -> Arc<Members> {
    Members::fixed(Listing {
        live: vec![url.to_string()],
        ..Listing::default()
    })
}

#[tokio::test]
async fn a_client_given_one_server_finds_them_all() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let first = join(&store, "a").await;
    let second = join(&store, "b").await;
    let members = Members::seeded(vec![second.url.clone()]);
    let listing = members.current(Some(TOKEN.into())).await;
    let mut both = vec![first.url.clone(), second.url.clone()];
    both.sort();
    assert_eq!(listing.live, both);

    let unauthorized = reqwest::get(format!("{}/members", first.url))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), 401);
}

#[tokio::test]
async fn a_server_that_leaves_hands_its_log_to_its_zone_and_removes_its_record() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let leaving = join(&store, "b").await;
    let staying = join(&store, "b").await;
    assert_eq!(records(&store).await, 2);

    let key = WriteLog::key("s3://bucket", "main");
    let record = LogRecord {
        claim: 4,
        n: 0,
        max_tag: 1,
        data: b"a change".to_vec(),
    };
    let on_leaving = WriteLog::over(only(&leaving.url), Some(TOKEN.into()), 1);
    on_leaving.seal(&key, 4).await.unwrap();
    on_leaving.append(&key, &record).await.unwrap();

    leaving.stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(30), leaving.done)
        .await
        .expect("drained in time")
        .unwrap()
        .unwrap();
    assert_eq!(records(&store).await, 1, "its record is gone");

    let on_staying = WriteLog::over(only(&staying.url), Some(TOKEN.into()), 1);
    assert_eq!(on_staying.seal(&key, 5).await.unwrap(), vec![record]);
    drop(staying.stop);
}
