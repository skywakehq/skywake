use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};

pub(crate) const DEFAULT_URL: &str = "https://api.skywake.dev";
const FIELDS: [&str; 3] = ["key", "url", "environment"];

pub(crate) type Profile = BTreeMap<String, String>;
pub(crate) type Profiles = BTreeMap<String, Profile>;

#[derive(Debug, Default, Clone)]
pub(crate) struct Asked {
    pub(crate) key: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) environment: Option<String>,
    pub(crate) profile: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Settings {
    pub(crate) key: Option<String>,
    pub(crate) url: String,
    pub(crate) environment: Option<String>,
}

pub(crate) fn path() -> Option<PathBuf> {
    if cfg!(windows) {
        return var("APPDATA").map(|dir| PathBuf::from(dir).join("skywake/credentials.toml"));
    }
    let base = var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join("skywake/credentials.toml"))
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

pub(crate) fn parse(text: &str) -> Profiles {
    let mut profiles = Profiles::new();
    let mut current: Option<String> = None;
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            let name = name.trim().to_string();
            profiles.entry(name.clone()).or_default();
            current = Some(name);
            continue;
        }
        let Some((field, value)) = line.split_once('=') else {
            continue;
        };
        let field = field.trim();
        let parsed = serde_json::from_str::<String>(value.trim());
        if let (Some(name), true, Ok(value)) = (&current, FIELDS.contains(&field), parsed) {
            profiles
                .entry(name.clone())
                .or_default()
                .insert(field.to_string(), value);
        }
    }
    profiles
}

pub(crate) fn render(profiles: &Profiles) -> String {
    let tables: Vec<String> = profiles
        .iter()
        .map(|(name, profile)| {
            let lines: Vec<String> = FIELDS
                .iter()
                .filter_map(|field| {
                    let value = profile.get(*field)?;
                    Some(format!("{field} = {}", serde_json::to_string(value).ok()?))
                })
                .collect();
            format!("[{name}]\n{}\n", lines.join("\n"))
        })
        .collect();
    tables.join("\n")
}

pub(crate) fn load() -> Profiles {
    path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| parse(&text))
        .unwrap_or_default()
}

pub(crate) fn store(profiles: &Profiles) -> Result<PathBuf> {
    let Some(path) = path() else {
        bail!("no home folder to keep credentials in: set HOME or XDG_CONFIG_HOME");
    };
    let dir = path.parent().expect("a file in a folder");
    std::fs::create_dir_all(dir).with_context(|| format!("making {}", dir.display()))?;
    let text = render(profiles);
    write_private(&path, &text).with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

#[cfg(unix)]
fn write_private(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(text.as_bytes())?;
    std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600))
}

#[cfg(not(unix))]
fn write_private(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    std::fs::write(path, text)
}

pub(crate) fn profile_name(asked: &Asked) -> String {
    asked
        .profile
        .clone()
        .or_else(|| var("SKYWAKE_PROFILE"))
        .unwrap_or_else(|| "default".to_string())
}

pub(crate) fn resolve(asked: &Asked, profiles: &Profiles) -> Settings {
    let given = asked
        .key
        .clone()
        .filter(|key| !key.is_empty())
        .or_else(|| var("SKYWAKE_API_KEY"))
        .or_else(|| var("SKYWAKE_KEY"));
    let stored = match given {
        Some(_) => None,
        None => profiles.get(&profile_name(asked)),
    };
    let from = |field: &str| stored.and_then(|profile| profile.get(field).cloned());
    Settings {
        key: given.or_else(|| from("key")),
        url: asked
            .url
            .clone()
            .or_else(|| var("SKYWAKE_URL"))
            .or_else(|| from("url"))
            .unwrap_or_else(|| DEFAULT_URL.to_string()),
        environment: asked
            .environment
            .clone()
            .or_else(|| var("SKYWAKE_ENV"))
            .or_else(|| from("environment")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profiles(text: &str) -> Profiles {
        parse(text)
    }

    #[test]
    fn parses_and_renders_profiles() {
        let text = "[default]\nkey = \"sw_a\"\nurl = \"http://x\"\n\n[staging]\nkey = \"sw_\\\"b\"\nenvironment = \"staging\"\n";
        let parsed = profiles(text);
        assert_eq!(parsed["default"]["key"], "sw_a");
        assert_eq!(parsed["staging"]["key"], "sw_\"b");
        assert_eq!(parse(&render(&parsed)), parsed);
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let parsed = profiles("# hi\n[default]\nkey = \"sw_a\"\ncolor = \"red\"\n");
        assert_eq!(parsed["default"].len(), 1);
    }

    #[test]
    fn a_given_key_ignores_the_profile() {
        let stored = profiles(
            "[default]\nkey = \"sw_file\"\nurl = \"http://file\"\nenvironment = \"prod\"\n",
        );
        let asked = Asked {
            key: Some("sw_flag".into()),
            ..Asked::default()
        };
        let settings = resolve(&asked, &stored);
        assert_eq!(settings.key.as_deref(), Some("sw_flag"));
        assert_eq!(settings.environment, None);
        let from_file = resolve(&Asked::default(), &stored);
        if var("SKYWAKE_API_KEY").is_none()
            && var("SKYWAKE_KEY").is_none()
            && var("SKYWAKE_URL").is_none()
        {
            assert_eq!(from_file.key.as_deref(), Some("sw_file"));
            assert_eq!(from_file.url, "http://file");
            assert_eq!(from_file.environment.as_deref(), Some("prod"));
        }
    }
}
