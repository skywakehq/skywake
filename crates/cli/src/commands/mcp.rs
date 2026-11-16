use std::process::Command;

use anyhow::{Result, bail};

use crate::cli::Global;

pub(crate) fn run(global: &Global, args: Vec<String>) -> Result<()> {
    let package = format!("skywake@{}", env!("CARGO_PKG_VERSION"));
    let mut command = Command::new(if cfg!(windows) { "npx.cmd" } else { "npx" });
    command.args(["--yes", &package, "mcp"]).args(args);
    let settings = [
        ("SKYWAKE_API_KEY", &global.key),
        ("SKYWAKE_URL", &global.url),
        ("SKYWAKE_ENV", &global.environment),
        ("SKYWAKE_PROFILE", &global.profile),
    ];
    for (name, value) in settings {
        if let Some(value) = value {
            command.env(name, value);
        }
    }
    let status = match command.status() {
        Ok(status) => status,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            bail!("the MCP server runs on Node: install Node.js 20 or newer, which brings npx")
        }
        Err(error) => return Err(error.into()),
    };
    std::process::exit(status.code().unwrap_or(1));
}
