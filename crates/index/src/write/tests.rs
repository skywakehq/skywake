use std::sync::Arc;
use std::sync::atomic::Ordering;

use object_store::memory::InMemory;

use crate::testing::{Gate, doc, ids, schema};
use crate::{Error, Id, Index, Kind, Options, Schema};

async fn until(ready: impl Fn() -> bool) {
    while !ready() {
        tokio::task::yield_now().await;
    }
}

async fn held_writes(gate: &Arc<Gate>, index: &Index) -> Vec<tokio::task::JoinHandle<()>> {
    gate.hold_next("chunks/", true);
    let mut writes = vec![tokio::spawn({
        let index = index.clone();
        async move { index.upsert(vec![doc(0)]).await.unwrap() }
    })];
    gate.held.notified().await;
    for id in 1..8u64 {
        let index = index.clone();
        writes.push(tokio::spawn(async move {
            index.upsert(vec![doc(id)]).await.unwrap()
        }));
    }
    until(|| index.writer.queued() == 7).await;
    writes
}

#[tokio::test]
async fn writes_that_arrive_during_a_write_go_together_in_one_segment() {
    let gate = Gate::new();
    let index = Index::create(gate.clone(), schema()).await.unwrap();
    let writes = held_writes(&gate, &index).await;
    gate.open();
    for write in writes {
        write.await.unwrap();
    }
    assert_eq!(index.version().await.unwrap().tail.len(), 2);
    assert_eq!(gate.chunk_puts.load(Ordering::SeqCst), 2);
    assert_eq!(
        ids(&index).await,
        (0..8u64).map(Id::from).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_group_takes_at_most_its_row_cap() {
    let gate = Gate::new();
    let options = Options {
        commit_rows: 3,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), schema(), options)
        .await
        .unwrap();
    let writes = held_writes(&gate, &index).await;
    gate.open();
    for write in writes {
        write.await.unwrap();
    }
    assert_eq!(index.version().await.unwrap().tail.len(), 4);
    assert_eq!(ids(&index).await.len(), 8);
}

#[tokio::test]
async fn a_full_queue_turns_writes_away_until_it_drains() {
    let gate = Gate::new();
    let options = Options {
        queued_rows: 7,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), schema(), options)
        .await
        .unwrap();
    let writes = held_writes(&gate, &index).await;
    let refused = index.upsert(vec![doc(8)]).await;
    assert!(matches!(refused, Err(Error::Busy(_))), "{refused:?}");
    gate.open();
    for write in writes {
        write.await.unwrap();
    }
    index.upsert(vec![doc(8)]).await.unwrap();
}

#[tokio::test]
async fn writes_wait_for_a_build_past_the_unbuilt_cap() {
    let options = Options {
        unbuilt_bytes: 1,
        ..Options::default()
    };
    let index = Index::create_with(Arc::new(InMemory::new()), schema(), options)
        .await
        .unwrap();
    index.upsert(vec![doc(0)]).await.unwrap();
    let refused = index.delete(vec![Id::from(0u64)]).await;
    assert!(matches!(refused, Err(Error::Busy(_))), "{refused:?}");
    index.build().await.unwrap();
    index.delete(vec![Id::from(0u64)]).await.unwrap();
}

#[tokio::test]
async fn a_lone_write_is_its_own_segment() {
    let index = Index::create(Arc::new(InMemory::new()), schema())
        .await
        .unwrap();
    for id in 0..3 {
        index.upsert(vec![doc(id)]).await.unwrap();
    }
    assert_eq!(index.version().await.unwrap().tail.len(), 3);
}

#[tokio::test]
async fn a_merge_adds_the_writes_of_a_branch_once_and_its_writes_win() {
    let main = Index::create(Arc::new(InMemory::new()), schema())
        .await
        .unwrap();
    let tagged = |id: u64, tag: &str| doc(id).attribute("tag", tag);
    main.upsert((0..10).map(doc).collect()).await.unwrap();
    main.build().await.unwrap();
    let dev = main.fork("dev").await.unwrap();
    dev.alter(&Schema::new().attribute("tag", Kind::String))
        .await
        .unwrap();
    dev.upsert(vec![tagged(3, "dev"), tagged(20, "dev")])
        .await
        .unwrap();
    dev.delete(vec![5.into()]).await.unwrap();
    main.upsert(vec![doc(3), doc(4)]).await.unwrap();

    assert!(main.merge("dev").await.unwrap() > 0);
    let tag = |main: Index, id: u64| async move {
        let doc = main.get(&Id::Num(id)).await.unwrap();
        doc.and_then(|doc| doc.attributes.get("tag").cloned())
    };
    assert_eq!(main.schema().await.unwrap().attributes["tag"], Kind::String);
    assert_eq!(tag(main.clone(), 3).await, Some("dev".into()));
    let expected: Vec<Id> = [0, 1, 2, 3, 4, 6, 7, 8, 9, 20].map(Id::Num).to_vec();
    assert_eq!(ids(&main).await, expected);

    main.upsert(vec![tagged(3, "main")]).await.unwrap();
    assert_eq!(main.merge("dev").await.unwrap(), 0);
    dev.upsert(vec![tagged(21, "dev")]).await.unwrap();
    assert_eq!(main.merge("dev").await.unwrap(), 1);
    main.build().await.unwrap();
    assert_eq!(tag(main.clone(), 3).await, Some("main".into()));
    assert_eq!(tag(main.clone(), 21).await, Some("dev".into()));

    assert!(main.merge("nope").await.is_err());
}
