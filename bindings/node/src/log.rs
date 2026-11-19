//! The engine's own log lines, as JSON on stderr beside the host's.

use std::sync::Once;

use tracing_subscriber::EnvFilter;

const DEFAULT: &str = "warn,skywake_index=info";

pub(crate) fn start() {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
        let filter =
            EnvFilter::try_from_env("SKYWAKE_LOG").unwrap_or_else(|_| EnvFilter::new(DEFAULT));
        let _ = tracing_subscriber::fmt()
            .json()
            .flatten_event(true)
            .with_current_span(false)
            .with_env_filter(filter)
            .with_writer(std::io::stderr)
            .try_init();
    });
}
