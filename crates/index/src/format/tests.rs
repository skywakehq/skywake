use crate::testing::{Gate, built, clustered};
use crate::{Index, Query};

#[tokio::test(flavor = "multi_thread")]
async fn clusters_of_format_4_are_still_read() {
    use serde::Serialize;
    use skywake_core::{Hash, Objects};

    use super::pages::Pages;
    use crate::vector::calibrate::Calibration;

    #[derive(Serialize)]
    struct Clusters4<'a> {
        centroids: Hash,
        table: &'a Pages,
        seed: u64,
        calibration: &'a Calibration,
    }
    #[derive(Serialize)]
    struct Ann4<'a> {
        columns: std::collections::BTreeMap<&'a String, Clusters4<'a>>,
        rows: &'a [Hash],
        rows_bytes: u64,
        live: u64,
        full_rows: u64,
        removed: u64,
        filters: Hash,
    }
    let gate = Gate::new();
    let index = built(&gate, 2000, 16, 2000).await;
    let now = index.version().await.unwrap();
    let ann = now.ann.as_ref().unwrap();
    let columns = (ann.columns.iter())
        .map(|(name, c)| {
            let clusters = Clusters4 {
                centroids: c.centroids,
                table: &c.table,
                seed: c.seed,
                calibration: &c.calibration,
            };
            (name, clusters)
        })
        .collect();
    let schema = &now.schema;
    let old = (
        4u32,
        now.parent,
        (&schema.vectors, &schema.attributes, &schema.text),
        &now.built,
        &now.tail,
        Some(Ann4 {
            columns,
            rows: &ann.rows,
            rows_bytes: ann.rows_bytes,
            live: ann.live,
            full_rows: ann.full_rows,
            removed: ann.removed,
            filters: ann.filters,
        }),
        now.next_seq,
        &now.text,
    );
    let hash = Objects::new(gate.clone()).put(&old).await.unwrap();
    crate::store::head::create(gate.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let query = Query::new("v", clustered(1, 16, 9).remove(0), 10);
    let opened = Index::open(gate.clone(), "old").await.unwrap();
    assert_eq!(
        opened.query(&query).await.unwrap(),
        index.query(&query).await.unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_version_of_format_6_opens_with_number_and_string_ids() {
    use skywake_core::Objects;

    let gate = Gate::new();
    let index = built(&gate, 2000, 16, 2000).await;
    let now = index.version().await.unwrap();
    let schema = &now.schema;
    let old = (
        6u32,
        now.parent,
        (&schema.vectors, &schema.attributes, &schema.text),
        &now.built,
        &now.tail,
        now.ann.as_ref().map(super::legacy::AnnV7::from),
        now.next_seq,
        &now.text,
    );
    let hash = Objects::new(gate.clone()).put(&old).await.unwrap();
    crate::store::head::create(gate.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let opened = Index::open(gate.clone(), "old").await.unwrap();
    assert_eq!(opened.schema().await.unwrap(), *schema);
    let query = Query::new("v", clustered(1, 16, 9).remove(0), 10);
    assert_eq!(
        opened.query(&query).await.unwrap(),
        index.query(&query).await.unwrap()
    );
}
