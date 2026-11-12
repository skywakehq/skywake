//! The write log kept by cache nodes: seal, append, trim, and copies across zones.

mod common;

use std::sync::Arc;

use object_store::memory::InMemory;
use skywake_cache::Node;
use skywake_core::Objects;
use skywake_core::cache::{ChunkCache, LogError, LogRecord, WriteLog};
use tempfile::{TempDir, tempdir};

use common::{TOKEN, serve};

fn cache_node(dirs: &TempDir, token: Option<String>) -> Node {
    let objects = Objects::new(Arc::new(InMemory::new()));
    let cache = ChunkCache::new(dirs.path().join("chunks"), u64::MAX).unwrap();
    Node::new(Arc::new(cache), objects, token)
}

async fn node(dirs: &TempDir, zone: &str) -> String {
    let node = cache_node(dirs, Some(TOKEN.into()))
        .with_log(dirs.path().join("log"), zone.into())
        .unwrap();
    serve(node).await
}

fn record(claim: u64, n: u64, max_tag: u64) -> LogRecord {
    LogRecord {
        claim,
        n,
        max_tag,
        data: format!("record {claim}/{n}").into_bytes(),
    }
}

#[tokio::test]
async fn a_newer_mount_reads_the_log_and_shuts_out_the_older_one() {
    let dirs = [tempdir().unwrap(), tempdir().unwrap()];
    let nodes = vec![node(&dirs[0], "a").await, node(&dirs[1], "b").await];
    let log = WriteLog::new(nodes, Some(TOKEN.into()), 2).unwrap();
    let key = WriteLog::key("s3://bucket", "main");

    assert!(log.seal(&key, 5).await.unwrap().is_empty());
    log.append(&key, &record(5, 0, 1)).await.unwrap();
    log.append(&key, &record(5, 1, 2)).await.unwrap();

    let found = log.seal(&key, 6).await.unwrap();
    assert_eq!(found, vec![record(5, 0, 1), record(5, 1, 2)]);
    assert!(matches!(
        log.append(&key, &record(5, 2, 3)).await,
        Err(LogError::TakenOver)
    ));

    log.append(&key, &record(6, 0, 0)).await.unwrap();
    log.trim(&key, 6, 0, 0).await;
    assert_eq!(log.seal(&key, 6).await.unwrap(), vec![record(6, 0, 0)]);
}

#[tokio::test]
async fn trim_keeps_records_with_changes_past_the_save() {
    let dirs = [tempdir().unwrap()];
    let log = WriteLog::new(vec![node(&dirs[0], "a").await], Some(TOKEN.into()), 1).unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    log.seal(&key, 1).await.unwrap();
    for (n, max_tag) in [(0, 2), (1, 9), (2, 4), (3, 5)] {
        log.append(&key, &record(1, n, max_tag)).await.unwrap();
    }
    log.trim(&key, 1, 3, 5).await;
    assert_eq!(
        log.seal(&key, 1).await.unwrap(),
        vec![record(1, 1, 9), record(1, 3, 5)]
    );
}

#[tokio::test]
async fn the_log_survives_a_restart_of_the_node() {
    let dirs = tempdir().unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    let first = WriteLog::new(vec![node(&dirs, "a").await], Some(TOKEN.into()), 1).unwrap();
    first.seal(&key, 3).await.unwrap();
    first.append(&key, &record(3, 0, 1)).await.unwrap();
    let again = WriteLog::new(vec![node(&dirs, "a").await], Some(TOKEN.into()), 1).unwrap();
    assert_eq!(again.seal(&key, 4).await.unwrap(), vec![record(3, 0, 1)]);
}

#[tokio::test]
async fn one_node_down_stops_appends_but_not_mounts() {
    let dirs = [tempdir().unwrap(), tempdir().unwrap()];
    let up = node(&dirs[0], "a").await;
    let down = "http://127.0.0.1:9".to_string();
    let both = WriteLog::new(vec![up.clone(), down], Some(TOKEN.into()), 2).unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    assert!(both.seal(&key, 2).await.is_ok());
    assert!(matches!(
        both.append(&key, &record(2, 0, 1)).await,
        Err(LogError::Unreachable)
    ));

    let one = WriteLog::new(vec![up], Some(TOKEN.into()), 2).unwrap();
    one.seal(&key, 3).await.unwrap();
    assert!(matches!(
        one.append(&key, &record(3, 0, 1)).await,
        Err(LogError::Unreachable)
    ));
    assert!(WriteLog::new(Vec::new(), None, 2).is_none());
}

#[tokio::test]
async fn copies_must_be_in_different_zones() {
    let dirs = [tempdir().unwrap(), tempdir().unwrap(), tempdir().unwrap()];
    let same = vec![node(&dirs[0], "a").await, node(&dirs[1], "a").await];
    let log = WriteLog::new(same.clone(), Some(TOKEN.into()), 2).unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    log.seal(&key, 1).await.unwrap();
    assert!(matches!(
        log.append(&key, &record(1, 0, 1)).await,
        Err(LogError::Unreachable)
    ));

    let mut spread = same;
    spread.push(node(&dirs[2], "b").await);
    let log = WriteLog::new(spread, Some(TOKEN.into()), 2).unwrap();
    log.seal(&key, 2).await.unwrap();
    log.append(&key, &record(2, 0, 1)).await.unwrap();
}

#[tokio::test]
async fn a_mount_waits_until_it_can_see_every_answered_record() {
    let dirs = [tempdir().unwrap(), tempdir().unwrap()];
    let up = [node(&dirs[0], "a").await, node(&dirs[1], "b").await];
    let down = "http://127.0.0.1:9".to_string();
    let key = WriteLog::key("s3://bucket", "main");

    let nodes = vec![up[0].clone(), up[1].clone(), down.clone()];
    let log = WriteLog::new(nodes, Some(TOKEN.into()), 2).unwrap();
    assert!(log.seal(&key, 1).await.is_ok());
    let nodes = vec![
        up[0].clone(),
        down.clone(),
        "http://127.0.0.1:7".to_string(),
    ];
    let log = WriteLog::new(nodes, Some(TOKEN.into()), 2).unwrap();
    assert!(matches!(
        log.seal(&key, 2).await,
        Err(LogError::Unreachable)
    ));
}

#[tokio::test]
async fn a_node_without_a_log_answers_for_none() {
    let dirs = tempdir().unwrap();
    let url = serve(cache_node(&dirs, None)).await;
    let log = WriteLog::new(vec![url], None, 1).unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    assert!(log.seal(&key, 1).await.unwrap().is_empty());
    assert!(matches!(
        log.append(&key, &record(1, 0, 1)).await,
        Err(LogError::Unreachable)
    ));
}

#[tokio::test]
async fn a_record_of_many_megabytes_is_kept() {
    let dirs = tempdir().unwrap();
    let log = WriteLog::new(vec![node(&dirs, "a").await], Some(TOKEN.into()), 1).unwrap();
    let key = WriteLog::key("s3://bucket", "main");
    log.seal(&key, 1).await.unwrap();
    let big = LogRecord {
        data: vec![7; 20 << 20],
        ..record(1, 0, 1)
    };
    log.append(&key, &big).await.unwrap();
    assert_eq!(log.seal(&key, 1).await.unwrap(), vec![big]);
}
