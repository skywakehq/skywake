//! Copies every record on a leaving server to another live server in its zone.

use std::sync::Arc;

use skywake_core::cache::LogRecord;
use skywake_core::cluster::Registration;
use tracing::{info, warn};

use super::Logs;

pub(crate) async fn hand_off(logs: &Arc<Logs>, registration: &Registration, token: Option<&str>) {
    let me = registration.me();
    let logs = logs.clone();
    let held = match tokio::task::spawn_blocking(move || logs.held()).await {
        Ok(Ok(held)) => held,
        Ok(Err(error)) => return warn!(%error, "can't read the write logs to hand them off"),
        Err(error) => return warn!(%error, "can't read the write logs to hand them off"),
    };
    if held.is_empty() {
        return;
    }
    let neighbours = match registration.neighbours().await {
        Ok(neighbours) if !neighbours.is_empty() => neighbours,
        Ok(_) => {
            return warn!("no other server in this zone: write log records keep one copy fewer");
        }
        Err(error) => return warn!(%error, "can't list the servers to hand write logs to"),
    };
    let client = reqwest::Client::new();
    let mut handed = 0;
    for (key, records) in held {
        let to = neighbours
            .iter()
            .max_by_key(|url| {
                *blake3::hash(format!("{url}/log/{key}/from/{me}").as_bytes()).as_bytes()
            })
            .expect("not empty");
        for record in records {
            let LogRecord {
                claim, n, max_tag, ..
            } = record;
            let url = format!("{to}/log/{key}/append?claim={claim}&n={n}&max_tag={max_tag}");
            let mut request = client.post(url).body(record.data);
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            match request
                .send()
                .await
                .map(|response| response.status().as_u16())
            {
                Ok(200 | 409) => handed += 1,
                Ok(status) => warn!(key, status, to, "a server refused a handed-off log record"),
                Err(error) => warn!(key, %error, to, "can't hand off a log record"),
            }
        }
    }
    info!(
        records = handed,
        "handed write log records to servers in this zone"
    );
}
