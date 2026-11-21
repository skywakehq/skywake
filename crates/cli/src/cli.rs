use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use skywake_core::HeadsAt;
use skywake_daemon::client_root;

#[derive(Parser)]
#[command(
    name = "skywake",
    version,
    about = "Skywake: shared disks of files for agents, with branches and search."
)]
pub(crate) struct Cli {
    #[command(flatten)]
    pub(crate) global: Global,

    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Args, Clone)]
pub(crate) struct Global {
    #[arg(long, global = true, help = "Print JSON instead of text, for scripts.")]
    pub(crate) json: bool,

    #[arg(
        long = "env",
        env = "SKYWAKE_ENV",
        global = true,
        help = "The environment, for a key that may use every one."
    )]
    pub(crate) environment: Option<String>,

    #[arg(
        long,
        env = "SKYWAKE_PROFILE",
        global = true,
        help = "Which saved profile to use (default `default`)."
    )]
    pub(crate) profile: Option<String>,

    #[arg(
        long,
        env = "SKYWAKE_API_KEY",
        hide_env_values = true,
        global = true,
        help = "An API key. Defaults to the one `skywake login` saved."
    )]
    pub(crate) key: Option<String>,

    #[arg(
        long,
        env = "SKYWAKE_URL",
        global = true,
        help = "Where the API is. Defaults to the profile's, then https://api.skywake.dev."
    )]
    pub(crate) url: Option<String>,

    #[arg(
        long,
        env = "SKYWAKE_STORE",
        global = true,
        num_args = 0..=1,
        require_equals = true,
        default_missing_value = "",
        value_name = "DIR",
        help = "Work on a store with no server, as --local or --local=DIR: `s3://bucket`, `gs://bucket`, `az://container` or a folder (default `.skywake`, or skywaked's store when it runs). The store is one disk; only the branch in NAME@BRANCH is used."
    )]
    pub(crate) local: Option<String>,

    #[arg(
        long,
        env = "SKYWAKE_ROOT",
        global = true,
        default_value_os_t = client_root(),
        hide_default_value = true,
        hide = true
    )]
    pub(crate) root: PathBuf,

    #[arg(
        long,
        env = "SKYWAKE_HEADS",
        default_value = "bucket",
        global = true,
        hide = true
    )]
    pub(crate) heads: HeadsAt,

    #[arg(
        long,
        env = "SKYWAKE_CACHE_NODES",
        value_delimiter = ',',
        global = true,
        hide = true
    )]
    pub(crate) cache_nodes: Vec<String>,

    #[arg(
        long,
        env = "SKYWAKE_CACHE_TOKEN",
        hide_env_values = true,
        global = true,
        hide = true
    )]
    pub(crate) cache_token: Option<String>,
}

#[derive(Args, Clone)]
pub(crate) struct Confirm {
    #[arg(long, short = 'y', help = "Don't ask first.")]
    pub(crate) yes: bool,
}

#[derive(Subcommand)]
pub(crate) enum Command {
    #[command(
        about = "Sign in through the browser, or save a key from --key, SKYWAKE_API_KEY or a paste."
    )]
    Login {
        #[arg(long, help = "Paste a key instead of signing in through the browser.")]
        paste: bool,
    },
    #[command(about = "Forget the profile's saved key.")]
    Logout,
    #[command(about = "Show the organization, environment and role of the key.")]
    Whoami,
    #[command(about = "Show the profile's environment, or switch it to NAME.")]
    Env { name: Option<String> },

    #[command(
        about = "Run Skywake on your own machine or cloud: plan, cost, deploy and look after it.",
        after_help = "Examples:\n  skywake deploy                      guided: finds where it can run, shows the plan and cost\n  skywake deploy plan --target aws    what it would make on AWS and the monthly cost\n  skywake deploy cost --data 500      every cloud and size side by side\n  skywake deploy --target local --yes --json   for scripts and agents"
    )]
    Deploy(Box<crate::deploy::Deploy>),

    #[command(about = "List disks.")]
    Disks,
    #[command(about = "Make a disk with settings chosen up front.")]
    Create {
        #[command(subcommand)]
        what: Create,
    },
    #[command(about = "Delete a disk, or with @BRANCH only that branch.")]
    Destroy {
        #[arg(value_name = "NAME[@BRANCH]")]
        target: String,
        #[command(flatten)]
        confirm: Confirm,
    },

    #[command(visible_alias = "ls", about = "List files on a disk.")]
    List {
        #[arg(value_name = "DISK[@BRANCH][/PATH]")]
        target: String,
        #[arg(long, short, help = "Every file below, not just this folder.")]
        recursive: bool,
        #[arg(long, help = "A commit or a time, to see the past.")]
        at: Option<String>,
    },
    #[command(visible_alias = "cat", about = "Print a file.")]
    Read {
        #[arg(value_name = "DISK[@BRANCH]/PATH")]
        target: String,
        #[arg(long, help = "A commit or a time, to see the past.")]
        at: Option<String>,
    },
    #[command(about = "Write a file from FILE, or from stdin with `-` or nothing.")]
    Write {
        #[arg(value_name = "DISK[@BRANCH]/PATH")]
        target: String,
        #[arg(value_name = "FILE|-")]
        file: Option<PathBuf>,
        #[arg(long, short, help = "The commit message.")]
        message: Option<String>,
        #[arg(long, help = "Mark the file executable.")]
        executable: bool,
    },
    #[command(
        visible_alias = "rm",
        about = "Delete files from a disk.",
        after_help = "Examples:\n  skywake delete app/notes.md app/old.md"
    )]
    Delete {
        #[arg(value_name = "DISK[@BRANCH]/PATH")]
        target: String,
        #[arg(value_name = "PATH")]
        more: Vec<String>,
        #[arg(long, short, help = "The commit message.")]
        message: Option<String>,
    },
    #[command(about = "Find lines matching a regular expression in a disk's files.")]
    Grep {
        pattern: String,
        #[arg(value_name = "DISK[@BRANCH][/PATH]")]
        target: String,
        #[arg(long, help = "Only files matching this glob.")]
        glob: Option<String>,
        #[arg(long, short, help = "Match either case.")]
        ignore_case: bool,
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        at: Option<String>,
    },
    #[command(about = "Find files and folders whose path matches a glob.")]
    Find {
        glob: String,
        #[arg(value_name = "DISK[@BRANCH][/PATH]")]
        target: String,
        #[arg(long, value_enum)]
        kind: Option<FindKind>,
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        at: Option<String>,
    },
    #[command(about = "Save a folder to a disk as one commit.")]
    Upload {
        dir: PathBuf,
        #[arg(value_name = "DISK[@BRANCH]")]
        target: String,
        #[arg(long, short, help = "The commit message.")]
        message: Option<String>,
    },
    #[command(about = "Copy a disk's files into a folder.")]
    Download {
        #[arg(value_name = "DISK[@BRANCH]")]
        target: String,
        dir: PathBuf,
        #[arg(long, help = "A commit or a time, to see the past.")]
        at: Option<String>,
    },
    #[command(
        about = "Mount a branch as a folder (needs skywaked). Changes are saved every few seconds."
    )]
    Mount {
        #[arg(value_name = "DISK[@BRANCH]")]
        target: String,
        mountpoint: PathBuf,
        #[arg(
            long,
            help = "Serve the branch to a VM: MOUNTPOINT is the socket it connects to. Inside, run `mount -t virtiofs skywake /mnt`."
        )]
        vm: bool,
        #[arg(
            long,
            conflicts_with = "fork",
            help = "Mount the current commit read-only, without claiming the branch."
        )]
        read_only: bool,
        #[arg(
            long,
            value_name = "NAME",
            help = "Fork the branch as NAME first, and mount the fork."
        )]
        fork: Option<String>,
        #[arg(long, value_name = "UID:GID", value_parser = parse_owner, help = "Who owns the files in the mount.")]
        owner: Option<(u32, u32)>,
        #[arg(long, help = "Let other users use the mount too.")]
        allow_other: bool,
    },
    #[command(about = "Save a mounted folder's changes now.")]
    Sync { mountpoint: PathBuf },
    #[command(about = "Save the last changes and unmount the folder.")]
    Unmount { mountpoint: PathBuf },
    #[command(about = "List the folders skywaked has mounted.")]
    Mounts,
    #[command(about = "Show how far each mount's saves are behind, and the chunk cache.")]
    Status,

    #[command(
        about = "Search a disk's files by meaning and keywords. The disk needs search on.",
        after_help = "Examples:\n  skywake query app \"where is auth handled\"\n  skywake query app@agent-1/docs \"rate limits\" --limit 5"
    )]
    Query {
        #[arg(value_name = "DISK[@BRANCH][/PATH]")]
        target: String,
        text: Option<String>,
        #[arg(long)]
        limit: Option<u32>,
    },

    #[command(about = "Make a branch from another, instantly.")]
    Fork {
        #[arg(value_name = "NAME[@BRANCH]")]
        target: String,
        new: String,
        #[arg(long, help = "The branch to fork (default main).")]
        from: Option<String>,
    },
    #[command(about = "Bring a branch's changes into another.")]
    Merge {
        #[arg(value_name = "NAME@BRANCH")]
        target: String,
        #[arg(long, default_value = "main")]
        into: String,
        #[arg(long, short, help = "The commit message.")]
        message: Option<String>,
        #[arg(long, help = "Report conflicts without merging.")]
        dry_run: bool,
    },
    #[command(about = "List a disk's branches.")]
    Branches { name: String },
    #[command(about = "Show a disk's commits, newest first.")]
    Log {
        #[arg(value_name = "NAME[@BRANCH]")]
        target: String,
        #[arg(long, help = "Only commits that changed this path.")]
        path: Option<String>,
        #[arg(long)]
        limit: Option<u32>,
    },
    #[command(about = "Show which files differ between two branches of a disk.")]
    Diff {
        #[arg(value_name = "DISK@BRANCH")]
        target: String,
        #[arg(default_value = "main")]
        against: String,
    },

    #[command(about = "List API keys, or make or revoke one.")]
    Keys {
        #[command(subcommand)]
        action: Option<Keys>,
    },
    #[command(
        about = "Run the MCP server, for agents (needs Node).",
        disable_help_flag = true
    )]
    Mcp {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },

    #[command(about = "Delete data no branch uses any more (with --local).")]
    Gc {
        #[arg(long, default_value_t = 8 * 24 * 60, help = "Only data older than this is deleted, so saves in progress are safe.")]
        grace_minutes: u64,
        #[arg(long, help = "Only count what would be deleted.")]
        dry_run: bool,
    },
    #[command(
        about = "Save changes a mount could not save as a commit on a new branch (with --local)."
    )]
    Recover {
        folder: PathBuf,
        branch: String,
        #[arg(long, short, default_value = "Recover unsaved changes")]
        message: String,
    },

    #[command(name = "__docs-spec", hide = true)]
    DocsSpec,
}

#[derive(Subcommand)]
pub(crate) enum Create {
    #[command(about = "Make a disk.")]
    Disk {
        name: String,
        #[arg(long)]
        region: Option<String>,
        #[arg(long, help = "Make its files searchable with `skywake query`.")]
        search: bool,
        #[arg(long, help = "Let anyone read it.")]
        public: bool,
    },
}

#[derive(Subcommand)]
pub(crate) enum Keys {
    #[command(about = "Make a key. It is printed once.")]
    Create {
        #[arg(long, value_enum)]
        role: RoleArg,
        #[arg(long, default_value = "cli")]
        name: String,
        #[arg(
            long,
            value_delimiter = ',',
            help = "Only these disks; `*` ends a prefix."
        )]
        only: Vec<String>,
        #[arg(long, help = "A key for every environment (organization admins).")]
        all_environments: bool,
        #[arg(long)]
        expires_in_days: Option<u32>,
    },
    #[command(about = "Revoke a key.")]
    Revoke {
        id: String,
        #[command(flatten)]
        confirm: Confirm,
    },
}

#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum FindKind {
    Files,
    Folders,
    Any,
}

#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum RoleArg {
    Read,
    Write,
    Admin,
}

fn parse_owner(text: &str) -> Result<(u32, u32), String> {
    let parsed = text
        .split_once(':')
        .and_then(|(uid, gid)| Some((uid.parse().ok()?, gid.parse().ok()?)));
    parsed.ok_or_else(|| "expected UID:GID, such as 1000:1000".to_string())
}
