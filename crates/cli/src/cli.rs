use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(
    name = "skywake",
    version,
    about = "Skywake: search indexes on object storage, with branches."
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

    #[command(about = "List indexes.")]
    Indexes,
    #[command(about = "Make an index with settings chosen up front.")]
    Create {
        #[command(subcommand)]
        what: Create,
    },
    #[command(about = "Delete an index, or with @BRANCH only that branch.")]
    Destroy {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        #[command(flatten)]
        confirm: Confirm,
    },

    #[command(
        visible_alias = "rm",
        about = "Delete rows from an index by id.",
        after_help = "Example:\n  skywake delete products 1 2 3"
    )]
    Delete {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        #[arg(value_name = "ID")]
        ids: Vec<String>,
    },
    #[command(
        about = "Add or replace rows from JSON lines, CSV or Parquet (a file, or stdin with `-`)."
    )]
    Upsert {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        #[arg(value_name = "FILE|-")]
        file: Option<PathBuf>,
        #[arg(
            long,
            value_enum,
            help = "Default: from the file's extension, else JSON lines."
        )]
        format: Option<Format>,
    },
    #[command(about = "Print one row.")]
    Get {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        id: String,
    },
    #[command(
        about = "Search an index by meaning and keywords.",
        after_help = "Example:\n  skywake query products \"running shoes\" --filter \"price < 100\""
    )]
    Query {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        text: Option<String>,
        #[arg(long, help = "Such as `tag = shoes and price < 100`, or JSON.")]
        filter: Option<String>,
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long, value_enum)]
        mode: Option<QueryMode>,
        #[arg(
            long,
            value_name = "JSON",
            help = "A vector, as a JSON list of numbers."
        )]
        vector: Option<String>,
        #[arg(
            long,
            value_name = "FIELD[:desc]",
            help = "Order by a field instead of by score."
        )]
        sort: Option<String>,
        #[arg(long, value_delimiter = ',', help = "Only these fields.")]
        fields: Vec<String>,
    },

    #[command(about = "Make a branch from another, instantly.")]
    Fork {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        new: String,
        #[arg(long, help = "The branch to fork (default main).")]
        from: Option<String>,
    },
    #[command(about = "Bring a branch's changes into another.")]
    Merge {
        #[arg(value_name = "INDEX@BRANCH")]
        target: String,
        #[arg(long, default_value = "main")]
        into: String,
    },
    #[command(about = "List an index's branches.")]
    Branches { name: String },
    #[command(about = "Show an index's versions, newest first.")]
    Log {
        #[arg(value_name = "INDEX[@BRANCH]")]
        target: String,
        #[arg(long)]
        limit: Option<u32>,
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
    #[command(
        about = "Write TypeScript types for every index, so `sky.index(name)` knows its rows."
    )]
    Types {
        #[arg(long, short, default_value = "skywake.d.ts")]
        out: PathBuf,
    },

    #[command(name = "__docs-spec", hide = true)]
    DocsSpec,
}

#[derive(Subcommand)]
pub(crate) enum Create {
    #[command(about = "Make an index.")]
    Index {
        name: String,
        #[arg(
            long,
            help = "The columns, as a JSON file: {\"vectors\": [..], \"attributes\": [..]}."
        )]
        schema: Option<PathBuf>,
        #[arg(long)]
        region: Option<String>,
        #[arg(
            long,
            conflicts_with = "no_embed",
            help = "The model that embeds text for search by meaning."
        )]
        embed: Option<String>,
        #[arg(long, help = "Keywords and filters only, no search by meaning.")]
        no_embed: bool,
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
            help = "Only these indexes; `*` ends a prefix."
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
pub(crate) enum QueryMode {
    Auto,
    Meaning,
    Keywords,
}

#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum RoleArg {
    Read,
    Write,
    Admin,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub(crate) enum Format {
    Jsonl,
    Csv,
    Parquet,
}
