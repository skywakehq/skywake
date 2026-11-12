//! The `skywake` command line.

mod api;
mod branch;
mod docs_spec;
mod index;
mod mount;
mod remote;

use std::path::PathBuf;

use anyhow::{Result, bail};
use clap::{CommandFactory, Parser, Subcommand};
use skywake_core::{HeadNodes, HeadsAt, Repo, granted_heads, open_store, remember_checks};
use skywake_daemon::{Request, Response, call, client_root, socket_path};

/// Skywake: a filesystem for agents.
#[derive(Parser)]
#[command(name = "skywake", version)]
struct Cli {
    /// `s3://bucket` or a local directory (default `.skywake`). Without
    /// it, `new`, `merge`, `delete` and `recover` go through skywaked if it
    /// runs, to its store, as its access file allows.
    #[arg(long, env = "SKYWAKE_STORE")]
    store: Option<String>,

    /// Folder where skywaked keeps its socket and local files. Default:
    /// `$XDG_STATE_HOME/skywake` (`~/.local/state/skywake`), or
    /// `/var/lib/skywake` as root or when only the system skywaked runs.
    #[arg(long, env = "SKYWAKE_ROOT", default_value_os_t = client_root(), hide_default_value = true)]
    root: PathBuf,

    /// Where branch heads live: `bucket`, or `tier` when the cache nodes keep them.
    /// Every machine using a store must agree.
    #[arg(long, env = "SKYWAKE_HEADS", default_value = "bucket", global = true)]
    heads: HeadsAt,

    /// Cache nodes that keep branch heads, with `--heads tier`.
    #[arg(
        long,
        env = "SKYWAKE_CACHE_NODES",
        value_delimiter = ',',
        global = true,
        hide = true
    )]
    cache_nodes: Vec<String>,

    /// The token of the cache nodes.
    #[arg(
        long,
        env = "SKYWAKE_CACHE_TOKEN",
        hide_env_values = true,
        global = true,
        hide = true
    )]
    cache_token: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a branch, empty or forked from another one.
    New {
        name: String,
        #[arg(long)]
        from: Option<String>,
    },
    /// Save a directory as the new version of a branch. Through the API,
    /// only what changed since `checkout` is sent.
    Commit {
        branch: String,
        dir: PathBuf,
        #[arg(short, long, default_value = "")]
        message: String,
        #[command(flatten)]
        remote: remote::Remote,
    },
    /// Copy a branch into an empty directory. With SKYWAKE_URL and
    /// SKYWAKE_KEY set (and no --store), through the API.
    Checkout {
        branch: String,
        dir: PathBuf,
        #[command(flatten)]
        remote: remote::Remote,
    },
    /// Show which paths differ between two branches.
    Diff { from: String, to: String },
    /// Merge one branch into another. Files both changed merge line by
    /// line; changes that overlap are reported and nothing is saved.
    Merge {
        from: String,
        into: String,
        #[arg(short, long)]
        message: Option<String>,
    },
    /// Show the commits on a branch, newest first.
    Log { branch: String },
    /// Show the versions of one file on a branch, newest first: each
    /// commit that changed it, and its size after.
    History { branch: String, path: String },
    /// List branches.
    Branches,
    /// Delete a branch. Its data stays until `gc`.
    Delete { branch: String },
    /// Delete data that no branch uses any more. Only data older than the
    /// grace period is deleted, so saves in progress are safe.
    Gc {
        /// Must be longer than any save takes, and than the API keeps
        /// uploaded parts waiting for a commit (7 days). Under 2 days is
        /// unsafe while anyone writes to the store.
        #[arg(long, default_value_t = 8 * 24 * 60)]
        grace_minutes: u64,
        /// Only count what would be deleted. Delete nothing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Mount a branch as a folder (needs skywaked). Changes are saved every
    /// few seconds. Use `commit` on the folder to save a named version.
    Mount {
        branch: String,
        mountpoint: PathBuf,
        /// Serve the branch to a VM instead. MOUNTPOINT is then the socket
        /// the VM connects to. Inside the VM, run
        /// `mount -t virtiofs skywake /mnt`.
        #[arg(long)]
        vm: bool,
        /// Mount the current commit read-only, without claiming the branch.
        /// Any number of readers can do this at once.
        #[arg(long, conflicts_with = "fork")]
        read_only: bool,
        /// Fork the branch as NAME first, and mount the fork.
        #[arg(long, value_name = "NAME")]
        fork: Option<String>,
        /// Who owns the branch's files in the mount. Default: the user
        /// running skywaked, or you if you are a member of its group.
        /// Members may only name themselves.
        #[arg(long, value_name = "UID:GID", value_parser = parse_owner)]
        owner: Option<(u32, u32)>,
        /// Let other users use the mount too. Permission bits still apply.
        /// Without it, only the owner of the files can use the mount.
        #[arg(long)]
        allow_other: bool,
    },
    /// Save a mounted folder's changes now. Returns when they are in the
    /// bucket. `fsync` on any file does the same.
    Sync { mountpoint: PathBuf },
    /// Save the last changes and unmount the folder.
    Unmount { mountpoint: PathBuf },
    /// List the folders skywaked has mounted.
    Mounts,
    /// Show how far each mount's saves are behind, and the chunk cache.
    Status,
    /// Save changes a mount could not save, kept in skywaked's `unsaved/`
    /// folder, as a commit on a new branch forked from the mount's branch.
    Recover {
        /// The kept folder, as skywaked reported it.
        folder: PathBuf,
        /// The new branch.
        branch: String,
        #[arg(short, long, default_value = "Recover unsaved changes")]
        message: String,
    },
    /// Search indexes: make them, write and query documents, fork branches.
    /// Talks to the API at SKYWAKE_URL with the key in SKYWAKE_KEY.
    Index(index::IndexArgs),
    /// Print the command tree as JSON, for the docs site.
    #[command(name = "__docs-spec", hide = true)]
    DocsSpec,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Index(args) => return index::run(args).await,
        Command::DocsSpec => {
            let spec = docs_spec::spec(Cli::command());
            println!("{}", serde_json::to_string_pretty(&spec)?);
            return Ok(());
        }
        Command::Checkout {
            branch,
            dir,
            remote,
        } if cli.store.is_none() && remote.chosen() => {
            return remote::checkout(&remote, &branch, dir).await;
        }
        Command::Commit {
            branch,
            dir,
            message,
            remote,
        } if cli.store.is_none() && remote.chosen() => {
            return remote::commit(&remote, &branch, dir, &message).await;
        }
        _ => {}
    }
    let command = match cli.command {
        command @ (Command::Mount { .. }
        | Command::Sync { .. }
        | Command::Unmount { .. }
        | Command::Mounts
        | Command::Status) => return mount::run(&cli.root, command).await,
        Command::Index(_) | Command::DocsSpec => unreachable!("handled above"),
        command => command,
    };
    let via_daemon = cli.store.is_none() && socket_path(&cli.root).exists();
    let store = cli.store.as_deref().unwrap_or(".skywake");
    let makes = matches!(
        command,
        Command::New { .. } | Command::Commit { .. } | Command::Recover { .. }
    );
    if cli.store.is_none() && !via_daemon && !makes && !std::path::Path::new(store).exists() {
        bail!(
            "no store here: `.skywake` does not exist. Pass --store, or run `skywake new <branch>`"
        );
    }
    remember_checks(cli.root.join("checked-stores"));
    let mut repo = Repo::new(open_store(store)?).with_cache(cli.root.join("objects"));
    if let Some(nodes) = granted_heads(store).await? {
        repo = repo.with_head_nodes(std::sync::Arc::new(nodes));
    } else if cli.heads == HeadsAt::Tier {
        let token = cli.cache_token.clone().filter(|token| !token.is_empty());
        let nodes = HeadNodes::new(cli.cache_nodes.clone(), token)
            .ok_or_else(|| anyhow::anyhow!("--heads tier needs SKYWAKE_CACHE_NODES"))?;
        repo = repo.with_head_nodes(std::sync::Arc::new(nodes));
    }
    branch::run(&repo, &cli.root, via_daemon, command).await
}

fn parse_owner(text: &str) -> Result<(u32, u32), String> {
    let parsed = text
        .split_once(':')
        .and_then(|(uid, gid)| Some((uid.parse().ok()?, gid.parse().ok()?)));
    parsed.ok_or_else(|| "expected UID:GID, such as 1000:1000".to_string())
}

async fn daemon(root: &std::path::Path, request: Request) -> Result<Response> {
    let response = call(root, &request).await.map_err(|error| {
        anyhow::anyhow!(
            "can't reach skywaked at {} ({error}); is it running?",
            root.display()
        )
    })?;
    match response {
        Response::Error(error) => bail!(error),
        Response::NotMounted => bail!("not a mounted folder"),
        response => Ok(response),
    }
}
