//! `s3-proxy <upstream host:port> [read ms] [write ms]`: prints `listening <port>`, then one line per finished request.

use std::io;
use std::time::Duration;

use skywake_benchmarks::proxy::Delays;

#[tokio::main]
async fn main() -> io::Result<()> {
    let mut args = std::env::args().skip(1);
    let upstream = (args.next()).expect("usage: s3-proxy <host:port> [read ms] [write ms]");
    let mut ms = || {
        args.next()
            .map(|ms| ms.parse::<u64>().expect("a delay in ms"))
    };
    let read = ms().unwrap_or(0);
    let write = ms().unwrap_or(read);
    let delays = Delays {
        read: Duration::from_millis(read),
        write: Duration::from_millis(write),
    };
    skywake_benchmarks::proxy::run(upstream, delays).await
}
