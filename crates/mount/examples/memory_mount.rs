//! Mounts an empty branch, stored in memory, at the given folder until
//! interrupted. For filesystem test suites such as pjdfstest:
//!
//!   cargo run -p skywake-mount --example memory_mount -- /mnt/test
//!
//! `fsync` saves, as in the daemon. Linux only.

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::sync::Arc;

    use object_store::memory::InMemory;
    use skywake_core::Repo;
    use skywake_mount::{BranchFs, ChunkCache, MountOptions};

    let mountpoint = std::env::args()
        .nth(1)
        .ok_or("usage: memory_mount <folder>")?;
    let repo = Repo::new(Arc::new(InMemory::new()));
    let empty = tempfile::tempdir()?;
    repo.create_branch("main", None).await?;
    repo.commit("main", empty.path(), "empty").await?;
    let (root, trees) = repo.head_tree("main").await?;
    let (cache_dir, scratch) = (tempfile::tempdir()?, tempfile::tempdir()?);
    let cache = Arc::new(ChunkCache::new(cache_dir.path().into(), 1 << 30)?);
    let fs = Arc::new(BranchFs::new(
        repo.objects().clone(),
        cache,
        scratch.path().into(),
        root,
        trees,
    )?);

    let (fsyncs, mut waiting) = tokio::sync::mpsc::unbounded_channel();
    let saving = fs.clone();
    tokio::spawn(async move {
        while let Some(done) = waiting.recv().await {
            // Nothing to commit to: the save is the whole job here.
            let saved = saving.save(&[]).await.map(|save| saving.committed(&save));
            let _: Result<(), _> = tokio::sync::oneshot::Sender::send(done, saved);
        }
    });
    let options = MountOptions {
        owner: None,
        allow_other: true,
    };
    let session = skywake_mount::mount_with_options(fs, mountpoint.as_ref(), fsyncs, &options)?;
    tokio::signal::ctrl_c().await?;
    session.umount_and_join()?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("FUSE needs Linux");
}
