//! skywaked: serves every Skywake mount on this machine.

#[cfg(target_os = "linux")]
mod mounted;
#[cfg(target_os = "linux")]
mod root;
#[cfg(target_os = "linux")]
mod server;
#[cfg(all(test, target_os = "linux"))]
mod tests;
#[cfg(target_os = "linux")]
mod unsaved;
#[cfg(target_os = "linux")]
mod user;

#[cfg(target_os = "linux")]
fn main() -> anyhow::Result<()> {
    user::serve_if_helper();
    serve()
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn serve() -> anyhow::Result<()> {
    use clap::Parser;
    skywake_cache::telemetry::init_logs();
    user::harden();
    keep_large_buffers_lazy();
    let result = server::run(server::Args::parse()).await;
    if let Err(error) = &result {
        tracing::error!("{error:#}");
    }
    result
}

#[cfg(target_os = "linux")]
fn keep_large_buffers_lazy() {
    #[cfg(target_env = "gnu")]
    // SAFETY: mallopt only changes allocator settings. No mount exists yet.
    unsafe {
        libc::mallopt(libc::M_MMAP_THRESHOLD, 1 << 20);
    }
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("skywaked serves mounts over FUSE, which needs Linux");
    std::process::exit(1);
}
