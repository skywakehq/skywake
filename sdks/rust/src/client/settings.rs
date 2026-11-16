use std::collections::HashMap;
use std::path::PathBuf;

use crate::{Error, Result};

pub(crate) const DEFAULT_URL: &str = "https://api.skywake.dev";
const FIELDS: [&str; 3] = ["key", "url", "environment"];

type Profile = HashMap<String, String>;

#[derive(Default)]
pub(crate) struct Asked {
    pub key: Option<String>,
    pub url: Option<String>,
    pub environment: Option<String>,
    pub profile: Option<String>,
}

pub(crate) struct Settings {
    pub key: String,
    pub url: String,
    pub environment: Option<String>,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

pub(crate) fn credentials_path() -> Option<PathBuf> {
    if cfg!(windows)
        && let Some(appdata) = env("APPDATA")
    {
        return Some(
            PathBuf::from(appdata)
                .join("skywake")
                .join("credentials.toml"),
        );
    }
    let base = env("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join("skywake").join("credentials.toml"))
}

pub(crate) fn parse_credentials(text: &str) -> HashMap<String, Profile> {
    let mut profiles: HashMap<String, Profile> = HashMap::new();
    let mut current = None;
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            let name = name.trim().to_string();
            profiles.entry(name.clone()).or_default();
            current = Some(name);
            continue;
        }
        let Some((field, value)) = pair(line) else {
            continue;
        };
        if let Some(profile) = current.as_ref().and_then(|name| profiles.get_mut(name)) {
            profile.insert(field, value);
        }
    }
    profiles
}

fn pair(line: &str) -> Option<(String, String)> {
    let (field, value) = line.split_once('=')?;
    let field = field.trim();
    let quoted = value.trim();
    let inner = quoted.strip_prefix('"')?.strip_suffix('"')?;
    if !FIELDS.contains(&field) {
        return None;
    }
    let value: String = serde_json::from_str(&format!("\"{inner}\"")).ok()?;
    Some((field.to_string(), value))
}

fn read_profile(name: &str) -> Profile {
    credentials_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| parse_credentials(&text).remove(name))
        .unwrap_or_default()
}

pub(crate) fn resolve(asked: Asked) -> Result<Settings> {
    let given = asked
        .key
        .or_else(|| env("SKYWAKE_API_KEY"))
        .or_else(|| env("SKYWAKE_KEY"));
    let mut stored = match given {
        Some(_) => Profile::new(),
        None => read_profile(
            &asked
                .profile
                .or_else(|| env("SKYWAKE_PROFILE"))
                .unwrap_or_else(|| "default".into()),
        ),
    };
    let key = given.or_else(|| stored.remove("key")).ok_or_else(|| {
        Error::Usage(
            "no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass a key to Skywake::builder()".into(),
        )
    })?;
    Ok(Settings {
        key,
        url: asked
            .url
            .or_else(|| env("SKYWAKE_URL"))
            .or_else(|| stored.remove("url"))
            .unwrap_or_else(|| DEFAULT_URL.into()),
        environment: asked
            .environment
            .or_else(|| env("SKYWAKE_ENV"))
            .or_else(|| stored.remove("environment")),
    })
}
