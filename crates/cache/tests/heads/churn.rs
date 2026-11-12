//! Heads stay right while servers join, crash and come back under steady writes.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use object_store::memory::InMemory;
use skywake_core::Refs;

use super::{Tier, commit};

const BRANCHES: usize = 16;
const WRITES: u64 = 30;

#[tokio::test(flavor = "multi_thread")]
async fn heads_stay_right_while_servers_join_crash_and_return() {
    let mut tier = Tier::reserve(Arc::new(InMemory::new()), &["a", "b", "c", "a"]);
    for n in 0..3 {
        tier.start(n, 2).await;
    }
    let refs = tier.refs();
    let writers: Vec<_> = (0..BRANCHES)
        .map(|b| {
            let refs = refs.clone();
            tokio::spawn(async move { write(&refs, &format!("agent-{b}")).await })
        })
        .collect();

    tokio::time::sleep(Duration::from_secs(2)).await;
    tier.start(3, 2).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    tier.crash(0);
    tokio::time::sleep(Duration::from_secs(5)).await;
    tier.start(0, 2).await;

    let mut acked = HashMap::new();
    for (b, writer) in writers.into_iter().enumerate() {
        acked.insert(format!("agent-{b}"), writer.await.unwrap());
    }
    for (branch, last) in acked {
        assert_eq!(last, WRITES, "{branch} did not finish");
        let head = refs.head(&branch).await.unwrap().unwrap();
        assert_eq!(
            head.commit.message,
            format!("{branch} {last}"),
            "{branch} lost a write"
        );
    }
}

async fn write(refs: &Refs, branch: &str) -> u64 {
    let deadline = Instant::now() + Duration::from_secs(150);
    let mut done = 0;
    while done < WRITES {
        assert!(Instant::now() < deadline, "{branch} stuck at {done}");
        let result = async {
            match refs.head(branch).await? {
                None => refs.create(branch, commit(&format!("{branch} 1"))).await,
                Some(head) => {
                    let seen: u64 = head
                        .commit
                        .message
                        .rsplit(' ')
                        .next()
                        .unwrap()
                        .parse()
                        .unwrap();
                    assert!(seen >= done, "{branch} went back from {done} to {seen}");
                    if seen > done {
                        return Ok(head);
                    }
                    let next = commit(&format!("{branch} {}", done + 1));
                    refs.advance(branch, &head, next).await
                }
            }
        }
        .await;
        match result {
            Ok(head) => {
                done = head
                    .commit
                    .message
                    .rsplit(' ')
                    .next()
                    .unwrap()
                    .parse()
                    .unwrap();
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
    done
}
