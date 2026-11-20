//! Connecting local agents to a disk. A mounted disk is a plain folder, so any
//! agent can work in it; the MCP server adds search, history and branches.
//! Nothing is written to an agent's settings until the person confirms.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value, json};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Agent {
    ClaudeCode,
    Cursor,
}

impl Agent {
    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "claude-code" => Ok(Agent::ClaudeCode),
            "cursor" => Ok(Agent::Cursor),
            _ => Err(format!("Skywake can't set up `{name}` yet.")),
        }
    }

    /// The settings file that lists the agent's MCP servers, for every project.
    pub fn settings(self, home: &Path) -> PathBuf {
        match self {
            Agent::ClaudeCode => home.join(".claude.json"),
            Agent::Cursor => home.join(".cursor/mcp.json"),
        }
    }
}

/// A name for the server in an agent's list: `skywake-prod-website`.
pub fn server_name(disk: &str, branch: &str) -> String {
    let mut name = format!("skywake-{disk}");
    if branch != "main" {
        name = format!("{name}-{branch}");
    }
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// The MCP server for one disk. It signs in with the key from `skywake login`.
pub fn server(api: &str, disk: &str, branch: &str) -> Value {
    let (env, name) = disk.split_once('/').unwrap_or(("", disk));
    let mut vars = Map::new();
    vars.insert("SKYWAKE_URL".into(), json!(api));
    if !env.is_empty() {
        vars.insert("SKYWAKE_ENV".into(), json!(env));
    }
    vars.insert("SKYWAKE_DISK".into(), json!(name));
    vars.insert("SKYWAKE_BRANCH".into(), json!(branch));
    json!({ "command": "npx", "args": ["-y", "skywake", "mcp"], "env": vars })
}

/// What a person sees before agreeing: the file, and the entry that goes in it.
#[derive(Serialize)]
pub struct Plan {
    pub file: PathBuf,
    pub name: String,
    pub entry: String,
    /// An entry by this name is there already and would be replaced.
    pub replaces: bool,
}

fn read(file: &Path) -> Result<Map<String, Value>, String> {
    match std::fs::read_to_string(file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(format!("Could not read {}: {error}", file.display())),
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str(&text) {
            Ok(Value::Object(settings)) => Ok(settings),
            _ => Err(format!(
                "{} is not JSON Skywake can safely change. Add the entry by hand.",
                file.display()
            )),
        },
    }
}

pub fn plan(
    home: &Path,
    agent: Agent,
    api: &str,
    disk: &str,
    branch: &str,
) -> Result<Plan, String> {
    let file = agent.settings(home);
    let name = server_name(disk, branch);
    let settings = read(&file)?;
    let replaces = settings
        .get("mcpServers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.contains_key(&name));
    let entry = json!({ "mcpServers": { &name: server(api, disk, branch) } });
    Ok(Plan {
        file,
        entry: serde_json::to_string_pretty(&entry).unwrap_or_default(),
        name,
        replaces,
    })
}

/// Adds the server to the agent's settings, keeping everything else in them.
pub fn add(
    home: &Path,
    agent: Agent,
    api: &str,
    disk: &str,
    branch: &str,
) -> Result<PathBuf, String> {
    let file = agent.settings(home);
    let mut settings = read(&file)?;
    let servers = settings
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(servers) = servers else {
        return Err(format!(
            "`mcpServers` in {} is not a list Skywake knows.",
            file.display()
        ));
    };
    servers.insert(server_name(disk, branch), server(api, disk, branch));
    let text = serde_json::to_string_pretty(&Value::Object(settings)).map_err(|e| e.to_string())?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    // Written beside it and moved over it, so a running agent never reads half a file.
    let partial = file.with_extension("json.skywake-partial");
    std::fs::write(&partial, text + "\n").map_err(|error| error.to_string())?;
    if let Ok(meta) = std::fs::metadata(&file) {
        let _ = std::fs::set_permissions(&partial, meta.permissions());
    }
    std::fs::rename(&partial, &file).map_err(|error| error.to_string())?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_for_every_agent() {
        assert_eq!(server_name("prod/website", "main"), "skywake-prod-website");
        assert_eq!(
            server_name("prod/website", "agents/fix 1"),
            "skywake-prod-website-agents-fix-1"
        );
    }

    #[test]
    fn the_server_names_its_environment_and_disk() {
        let server = server("https://api.skywake.dev", "prod/website", "main");
        assert_eq!(server["env"]["SKYWAKE_ENV"], "prod");
        assert_eq!(server["env"]["SKYWAKE_DISK"], "website");
        assert_eq!(server["args"], json!(["-y", "skywake", "mcp"]));
    }

    #[test]
    fn adding_keeps_the_rest_of_the_settings() {
        let home = std::env::temp_dir().join(format!("skywake-agents-{}", std::process::id()));
        let file = Agent::Cursor.settings(&home);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(
            &file,
            r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#,
        )
        .unwrap();

        let plan = plan(&home, Agent::Cursor, "http://api", "prod/website", "main").unwrap();
        assert!(!plan.replaces);
        add(&home, Agent::Cursor, "http://api", "prod/website", "main").unwrap();
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["theme"], "dark");
        assert_eq!(saved["mcpServers"]["other"]["command"], "x");
        assert_eq!(
            saved["mcpServers"]["skywake-prod-website"]["command"],
            "npx"
        );
        assert!(plan_again(&home));

        std::fs::write(&file, "not json").unwrap();
        assert!(add(&home, Agent::Cursor, "http://api", "prod/website", "main").is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "not json");
        std::fs::remove_dir_all(&home).unwrap();
    }

    fn plan_again(home: &Path) -> bool {
        plan(home, Agent::Cursor, "http://api", "prod/website", "main")
            .unwrap()
            .replaces
    }
}
