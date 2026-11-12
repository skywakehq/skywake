//! HTTP clients for talking to other servers, and the hash that ranks servers.

use std::time::Duration;

pub(crate) fn client(connect: Duration, answer: Option<Duration>) -> reqwest::Client {
    let builder = reqwest::Client::builder().connect_timeout(connect);
    let builder = match answer {
        Some(answer) => builder.timeout(answer),
        None => builder,
    };
    builder.build().expect("an HTTP client with timeouts only")
}

pub(crate) fn score(text: &str) -> u64 {
    let hash = blake3::hash(text.as_bytes());
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().expect("8 bytes"))
}
