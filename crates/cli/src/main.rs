mod cli;
mod commands;
mod credentials;
mod docs_spec;
mod input;
mod local;
mod output;
mod session;
mod target;

use anyhow::Result;
use clap::{CommandFactory, Parser};

use cli::{Cli, Command};

#[tokio::main]
async fn main() -> Result<()> {
    let Cli { global, command } = Cli::parse();
    match command {
        Command::DocsSpec => output::json(&docs_spec::spec(Cli::command())),
        command if local::is_mount(&command) => local::mounts(&global, command).await,
        command if global.local.is_some() => local::run(&global, command).await,
        command => commands::run(&global, command).await,
    }
}
