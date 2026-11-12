//! Customer-managed keys on a real S3 bucket (run by benchmarks/cloud/aws/run.sh).

use object_store::ObjectStoreExt;
use object_store::path::Path;
use skywake_core::{Encryption, open_store, open_store_with};

const KEY: &str = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

fn var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("set {name}"))
}

#[tokio::test]
#[ignore = "needs a real S3 bucket and a KMS key: benchmarks/cloud/aws/run.sh runs it"]
async fn a_real_bucket_stores_with_our_keys_and_refuses_reads_without_them() {
    let bucket = var("SKYWAKE_TEST_BUCKET");
    let at = Path::from("check");

    let kms = Encryption::Kms(var("SKYWAKE_TEST_KMS_KEY"));
    let store = open_store_with(&format!("{bucket}/kms"), Some(&kms)).unwrap();
    store.put(&at, "kms".into()).await.unwrap();
    let read = store.get(&at).await.unwrap().bytes().await.unwrap();
    assert_eq!(read, "kms");

    let customer = Encryption::Customer(KEY.into());
    let store = open_store_with(&format!("{bucket}/customer"), Some(&customer)).unwrap();
    store.put(&at, "customer".into()).await.unwrap();
    let read = store.get(&at).await.unwrap().bytes().await.unwrap();
    assert_eq!(read, "customer");

    let plain = open_store(&format!("{bucket}/customer")).unwrap();
    assert!(plain.get(&at).await.is_err());
}
