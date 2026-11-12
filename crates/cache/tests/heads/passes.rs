//! Passes from the API: what they allow, and how clients renew them.

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::prefix::PrefixStore;
use skywake_core::store::refs::{self, Pass, Slot};
use skywake_core::{Error, Refs};

use super::common::{TOKEN, listen};
use super::{commit, tier};

fn pass(folder: &str, access: &str, protected: &[&str], seconds: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    Pass {
        folder: folder.into(),
        access: access.into(),
        protected: protected.iter().map(|name| name.to_string()).collect(),
        expires: (now + seconds) as u64,
    }
    .sign(TOKEN)
}

fn denied<T: fmt::Debug>(result: Result<T, Error>) {
    assert!(
        matches!(
            result,
            Err(Error::Store(object_store::Error::PermissionDenied { .. }))
        ),
        "{result:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pass_reaches_only_what_the_api_allowed() {
    let tier = tier().await;
    let writer = tier.refs_in("org/a", &pass("org/a", "write", &["main"], 60));
    let head = writer.create("work", commit("one")).await.unwrap();
    writer.advance("work", &head, commit("two")).await.unwrap();
    denied(writer.create("main", commit("x")).await);
    let api = tier.refs_in("org/a", TOKEN);
    api.create("main", commit("api")).await.unwrap();
    assert_eq!(
        writer.head("main").await.unwrap().unwrap().commit.message,
        "api"
    );

    denied(
        tier.refs_in("org/b", &pass("org/a", "write", &[], 60))
            .head("work")
            .await,
    );
    let other = tier.refs_in("org/b", TOKEN);
    assert!(other.head("work").await.unwrap().is_none());
    other.create("work", commit("b")).await.unwrap();
    assert_eq!(
        writer.head("work").await.unwrap().unwrap().commit.message,
        "two"
    );

    let reader = tier.refs_in("org/a", &pass("org/a", "read", &[], 60));
    assert_eq!(reader.list().await.unwrap(), vec!["main", "work"]);
    denied(reader.create("new", commit("x")).await);
    denied(
        tier.refs_in("org/a", &pass("org/a", "write", &[], -1))
            .head("work")
            .await,
    );
    let forged = pass("org/a", "write", &[], 60).replace('.', ".x");
    denied(tier.refs_in("org/a", &forged).head("work").await);

    let a: Arc<dyn ObjectStore> = Arc::new(PrefixStore::new(tier.store.clone(), "org/a"));
    for _ in 0..100 {
        if let Slot::Live(head) = refs::read(a.as_ref(), "work").await.unwrap()
            && head.seq == 1
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("org/a/refs/work never reached the bucket");
}

#[tokio::test(flavor = "multi_thread")]
async fn held_objects_must_be_content_of_the_namespace() {
    let tier = tier().await;
    let writer = tier.refs_in("org/a", &pass("org/a", "write", &[], 60));
    let head = writer.create("work", commit("one")).await.unwrap();
    let held = vec![skywake_core::heads::Held {
        path: "refs/main".into(),
        stored: vec![1],
    }];
    let since = std::time::SystemTime::now();
    denied(
        writer
            .advance_holding("work", &head, commit("two"), held, since)
            .await,
    );
}

async fn fake_api(
    tier_urls: Vec<String>,
    seconds: i64,
) -> (String, Arc<std::sync::atomic::AtomicU32>) {
    let grants = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counted = grants.clone();
    let app = axum::Router::new().route(
        "/v1/namespaces/{namespace}/credentials",
        axum::routing::post(move || {
            let counted = counted.clone();
            let nodes = tier_urls.clone();
            async move {
                counted.fetch_add(1, Ordering::SeqCst);
                let expires = chrono::Utc::now() + chrono::Duration::seconds(seconds);
                let body = format!(
                    r#"{{"store":"s3://bucket/org/a","region":"auto","endpoint":null,"accessKeyId":"k","secretAccessKey":"s","sessionToken":"t","expiresAt":"{}","access":"write","heads":{{"nodes":{:?},"folder":"org/a","pass":"{}"}}}}"#,
                    expires.to_rfc3339(),
                    nodes,
                    pass("org/a", "write", &["main"], seconds),
                );
                ([(axum::http::header::CONTENT_TYPE, "application/json")], body)
            }
        }),
    );
    let (listener, url) = listen().await;
    tokio::spawn(async move { axum::serve(listener, app).await });
    (url, grants)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_of_the_api_uses_the_heads_it_was_granted_and_renews_its_pass() {
    let tier = tier().await;
    let (api, grants) = fake_api(tier.urls.clone(), 3).await;
    unsafe {
        std::env::set_var("SKYWAKE_API_URL", &api);
        std::env::set_var("SKYWAKE_API_KEY", "key");
    }
    let nodes = skywake_core::granted_heads("skywake://org/a")
        .await
        .unwrap()
        .expect("granted heads");
    let store: Arc<dyn ObjectStore> = Arc::new(PrefixStore::new(tier.store.clone(), "org/a"));
    let refs = Refs::new(store).served_by(Arc::new(nodes));
    let head = refs.create("work", commit("one")).await.unwrap();
    denied(refs.create("main", commit("x")).await);
    tokio::time::sleep(Duration::from_secs(4)).await;
    refs.advance("work", &head, commit("two")).await.unwrap();
    assert!(
        grants.load(Ordering::SeqCst) >= 2,
        "the pass was never renewed"
    );
}
