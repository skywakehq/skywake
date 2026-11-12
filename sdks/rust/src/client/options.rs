use std::time::Duration;

/// How long to wait and how often to try again.
#[derive(Clone, Debug)]
pub struct Options {
    /// How long one try may wait to connect, and then for each piece of the
    /// answer. A large export that keeps arriving is never cut off.
    pub timeout: Duration,
    /// Failed requests are tried up to this many more times when that is safe.
    pub retries: u32,
    /// About how long to wait before the first retry, doubled each time,
    /// unless the server asks for longer (at most 60 seconds).
    pub backoff: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            timeout: Duration::from_secs(60),
            retries: 3,
            backoff: Duration::from_millis(200),
        }
    }
}
