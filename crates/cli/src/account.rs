use std::io::{BufRead, IsTerminal, Write};

use anyhow::{Result, bail};
use clap::Args;
use serde_json::Value;

use crate::api::Api;
use crate::credentials::{self, Asked, DEFAULT_URL, Profile, Settings};

#[derive(Args, Clone, Default)]
pub(crate) struct Account {
    /// Where the API is. Defaults to the profile's, then the cloud.
    #[arg(long, env = "SKYWAKE_URL", global = true)]
    pub(crate) url: Option<String>,

    /// An API key (`sw_...`). Defaults to the one `skywake login` saved.
    #[arg(long, env = "SKYWAKE_API_KEY", hide_env_values = true, global = true)]
    pub(crate) key: Option<String>,

    /// The environment, for a key that may use every one.
    #[arg(long = "env", env = "SKYWAKE_ENV", global = true)]
    pub(crate) environment: Option<String>,

    /// Which saved profile to use.
    #[arg(long, env = "SKYWAKE_PROFILE", global = true)]
    pub(crate) profile: Option<String>,
}

impl Account {
    fn asked(&self) -> Asked {
        Asked {
            key: self.key.clone(),
            url: self.url.clone(),
            environment: self.environment.clone(),
            profile: self.profile.clone(),
        }
    }

    pub(crate) fn settings(&self) -> Settings {
        credentials::resolve(&self.asked(), &credentials::load())
    }

    pub(crate) fn api(&self) -> Result<Api> {
        Api::connect(&self.settings())
    }
}

pub(crate) async fn login(account: &Account) -> Result<()> {
    let key = match account.key.clone().filter(|key| !key.is_empty()) {
        Some(key) => key,
        None => prompt_key()?,
    };
    let url = account
        .url
        .clone()
        .unwrap_or_else(|| DEFAULT_URL.to_string());
    let settings = Settings {
        key: Some(key.clone()),
        url: url.clone(),
        environment: account.environment.clone(),
    };
    let who = Api::connect(&settings)?.get("/whoami").await?;
    let name = credentials::profile_name(&account.asked());
    let mut profile = Profile::new();
    profile.insert("key".into(), key);
    if url != DEFAULT_URL {
        profile.insert("url".into(), url);
    }
    if let Some(environment) = &account.environment {
        profile.insert("environment".into(), environment.clone());
    }
    let mut profiles = credentials::load();
    profiles.insert(name.clone(), profile);
    let path = credentials::store(&profiles)?;
    println!("Signed in. {}", describe(&who));
    println!("Saved as profile `{name}` in {}", path.display());
    Ok(())
}

pub(crate) fn logout(account: &Account) -> Result<()> {
    let name = credentials::profile_name(&account.asked());
    let mut profiles = credentials::load();
    if profiles.remove(&name).is_none() {
        bail!("no saved profile `{name}`");
    }
    credentials::store(&profiles)?;
    println!("Signed out of profile `{name}`.");
    Ok(())
}

pub(crate) async fn whoami(account: &Account, json: bool) -> Result<()> {
    let who = account.api()?.get("/whoami").await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&who)?);
    } else {
        println!("{}", describe(&who));
    }
    Ok(())
}

fn describe(who: &Value) -> String {
    let text = |field: &str| who[field].as_str().unwrap_or("").to_string();
    let environment = match who["environment"].as_str() {
        Some(environment) => format!("environment `{environment}`"),
        None => "every environment (pick one with --env)".to_string(),
    };
    let only = match who["only"].as_array() {
        Some(only) if only.iter().any(|each| each != "*") => {
            let names: Vec<&str> = only.iter().filter_map(Value::as_str).collect();
            format!(", only {}", names.join(", "))
        }
        _ => String::new(),
    };
    format!(
        "Organization {}, {}, role `{}`{only}.",
        text("organization"),
        environment,
        text("role")
    )
}

fn prompt_key() -> Result<String> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        print!("Paste an API key (make one in the console under Settings → API keys): ");
        std::io::stdout().flush()?;
    }
    let mut line = String::new();
    stdin.lock().read_line(&mut line)?;
    let key = line.trim().to_string();
    if key.is_empty() {
        bail!("no key given: paste one, or pass --key");
    }
    Ok(key)
}
