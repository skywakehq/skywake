use std::io::{BufRead, IsTerminal, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use serde_json::json;
use skywake::{ErrorKind, NewLogin, Skywake, Whoami};

use crate::cli::Global;
use crate::credentials::{self, Profile};
use crate::new_key::NewKey;
use crate::output;
use crate::session::Session;

const LOGIN_WAIT: Duration = Duration::from_secs(600);
const POLL: Duration = Duration::from_secs(2);

pub(crate) async fn login(global: &Global, paste: bool) -> Result<()> {
    let (key, who) = match global.key.clone().filter(|key| !key.is_empty()) {
        Some(key) => checked(global, key).await?,
        None if paste || !std::io::stdin().is_terminal() => checked(global, prompt_key()?).await?,
        None => through_browser(global).await?,
    };
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
    let saved = json!({ "profile": name, "path": path, "whoami": who });
    output::either(global.json, &saved, |_| {
        println!("Signed in. {}", describe(&who));
        println!("Saved as profile `{name}` in {}", path.display());
    })
}

fn client(global: &Global, key: &str) -> Result<Skywake> {
    let mut builder = Skywake::builder().key(key);
    if let Some(url) = &global.url {
        builder = builder.url(url);
    }
    if let Some(environment) = &global.environment {
        builder = builder.environment(environment);
    }
    Ok(builder.build()?)
}

async fn checked(global: &Global, key: String) -> Result<(String, Whoami)> {
    let who = client(global, &key)?.whoami().await?;
    Ok((key, who))
}

async fn through_browser(global: &Global) -> Result<(String, Whoami)> {
    let made = NewKey::make()?;
    let sky = client(global, &made.key)?;
    let login = NewLogin {
        key_id: made.id.clone(),
        key_hash: made.hash(),
        device: device(),
    };
    let started = sky.start_login(&login).await?;
    eprintln!("Your code: {}", started.code);
    match &started.url {
        Some(url) => {
            eprintln!("Check that the browser shows the same code, then allow it: {url}");
            open_browser(url);
        }
        None => eprintln!("Open /cli in the Skywake console, enter the code and allow it."),
    }
    eprintln!("Waiting for you to allow it. Ctrl-C stops.");
    let deadline = Instant::now() + LOGIN_WAIT;
    loop {
        tokio::time::sleep(POLL).await;
        match sky.whoami().await {
            Ok(who) => return Ok((made.key, who)),
            Err(error) if error.kind() != Some(&ErrorKind::Auth) => return Err(error.into()),
            Err(_) if Instant::now() >= deadline => {
                bail!("the code expired before it was allowed: run `skywake login` again")
            }
            Err(_) => {}
        }
    }
}

fn device() -> String {
    let named = Command::new("hostname")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|name| name.trim().chars().take(64).collect::<String>())
        .filter(|name| !name.is_empty());
    named.unwrap_or_else(|| "a computer".to_string())
}

fn open_browser(url: &str) {
    let opener = match std::env::consts::OS {
        "macos" => "open",
        "windows" => "explorer",
        _ => "xdg-open",
    };
    let _ = Command::new(opener)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
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
