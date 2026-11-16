use std::io::{BufRead, IsTerminal, Write};

use anyhow::{Result, bail};
use skywake::{Skywake, Whoami};

use crate::cli::Global;
use crate::credentials::{self, Profile};
use crate::output;
use crate::session::Session;

pub(crate) async fn login(global: &Global) -> Result<()> {
    let key = match global.key.clone().filter(|key| !key.is_empty()) {
        Some(key) => key,
        None => prompt_key()?,
    };
    let mut builder = Skywake::builder().key(&key);
    if let Some(url) = &global.url {
        builder = builder.url(url);
    }
    if let Some(environment) = &global.environment {
        builder = builder.environment(environment);
    }
    let who = builder.build()?.whoami().await?;
    let name = credentials::profile_name(global.profile.as_deref());
    let mut profile = Profile::new();
    profile.insert("key".into(), key);
    if let Some(url) = &global.url {
        profile.insert("url".into(), url.clone());
    }
    if let Some(environment) = &global.environment {
        profile.insert("environment".into(), environment.clone());
    }
    let mut profiles = credentials::load();
    profiles.insert(name.clone(), profile);
    let path = credentials::store(&profiles)?;
    println!("Signed in. {}", describe(&who));
    println!("Saved as profile `{name}` in {}", path.display());
    Ok(())
}

pub(crate) fn logout(global: &Global) -> Result<()> {
    let name = credentials::profile_name(global.profile.as_deref());
    let mut profiles = credentials::load();
    if profiles.remove(&name).is_none() {
        bail!("no saved profile `{name}`");
    }
    credentials::store(&profiles)?;
    println!("Signed out of profile `{name}`.");
    Ok(())
}

pub(crate) async fn whoami(session: &Session) -> Result<()> {
    let who = session.sky.whoami().await?;
    output::either(session.json, &who, |who| println!("{}", describe(who)))
}

pub(crate) async fn env(global: &Global, name: Option<String>) -> Result<()> {
    let profile = credentials::profile_name(global.profile.as_deref());
    let Some(name) = name else {
        let session = Session::open(global)?;
        let who = session.sky.whoami().await?;
        let current = session
            .sky
            .environment()
            .map(String::from)
            .or(who.environment);
        let text = match &current {
            Some(current) => current.clone(),
            None => "none: the key may use every environment; pick one with `skywake env NAME`"
                .to_string(),
        };
        return output::report(
            session.json,
            serde_json::json!({ "environment": current }),
            text,
        );
    };
    let mut profiles = credentials::load();
    let Some(saved) = profiles.get_mut(&profile) else {
        bail!("no saved profile `{profile}`: run `skywake login` first");
    };
    saved.insert("environment".into(), name.clone());
    credentials::store(&profiles)?;
    println!("Profile `{profile}` now uses environment `{name}`.");
    Ok(())
}

fn describe(who: &Whoami) -> String {
    let environment = match &who.environment {
        Some(environment) => format!("environment `{environment}`"),
        None => "every environment (pick one with --env)".to_string(),
    };
    let only = match who.only.iter().any(|name| name != "*") {
        true => format!(", only {}", who.only.join(", ")),
        false => String::new(),
    };
    let role = serde_json::to_value(who.role).unwrap_or_default();
    format!(
        "Organization {}, {environment}, role `{}`{only}.",
        who.organization,
        output::cell(&role)
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
