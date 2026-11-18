use std::fmt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use clap::ValueEnum;
use serde::{Deserialize, Serialize};

pub(crate) const FILE: &str = "skywake.deploy.toml";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Target {
    Local,
    Docker,
    Kubernetes,
    Aws,
    Gcp,
    Azure,
}

impl Target {
    pub(crate) const ALL: [Target; 6] = [
        Target::Local,
        Target::Docker,
        Target::Kubernetes,
        Target::Aws,
        Target::Gcp,
        Target::Azure,
    ];

    pub(crate) fn cloud(self) -> bool {
        matches!(self, Target::Aws | Target::Gcp | Target::Azure)
    }

    pub(crate) fn about(self) -> &'static str {
        match self {
            Target::Local => "this machine, in Docker",
            Target::Docker => "any server you can reach over SSH",
            Target::Kubernetes => "a cluster from your kube context",
            Target::Aws => "Amazon Web Services",
            Target::Gcp => "Google Cloud",
            Target::Azure => "Microsoft Azure",
        }
    }

    pub(crate) fn default_region(self) -> Option<&'static str> {
        match self {
            Target::Aws => Some("us-east-1"),
            Target::Gcp => Some("us-central1"),
            Target::Azure => Some("eastus"),
            _ => None,
        }
    }
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = self.to_possible_value().expect("every target has a name");
        f.write_str(name.get_name())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Size {
    Tiny,
    Small,
    Medium,
    Large,
}

impl Size {
    pub(crate) const ALL: [Size; 4] = [Size::Tiny, Size::Small, Size::Medium, Size::Large];

    pub(crate) fn about(self) -> &'static str {
        match self {
            Size::Tiny => "one small server: trying it, side projects",
            Size::Small => "one server: a team, millions of rows",
            Size::Medium => "one bigger server and a managed database",
            Size::Large => "a cluster across zones: no single point of failure",
        }
    }

    pub(crate) fn clustered(self) -> bool {
        self == Size::Large
    }
}

impl fmt::Display for Size {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = self.to_possible_value().expect("every size has a name");
        f.write_str(name.get_name())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Database {
    #[default]
    Bundled,
    Managed,
    External,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub name: String,
    pub target: Target,
    pub size: Size,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default = "data_default")]
    pub data_gb: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    #[serde(default)]
    pub database: Database,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default)]
    pub images: Images,
    #[serde(default)]
    pub ports: Ports,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Images {
    pub registry: String,
    pub version: String,
}

impl Default for Images {
    fn default() -> Self {
        Self {
            registry: "ghcr.io/skywakehq".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Ports {
    pub api: u16,
    pub console: u16,
    pub zero: u16,
}

impl Default for Ports {
    fn default() -> Self {
        Self {
            api: 8080,
            console: 3100,
            zero: 4848,
        }
    }
}

fn data_default() -> u32 {
    50
}

impl Settings {
    pub(crate) fn new(name: &str, target: Target, size: Size) -> Self {
        Self {
            name: name.into(),
            target,
            size,
            region: target.default_region().map(String::from),
            domain: None,
            data_gb: data_default(),
            bucket: None,
            database: match size {
                Size::Medium | Size::Large if target.cloud() => Database::Managed,
                _ => Database::Bundled,
            },
            host: None,
            images: Images::default(),
            ports: Ports::default(),
        }
    }

    pub(crate) fn parse(text: &str) -> Result<Self> {
        let settings: Self = toml::from_str(text)?;
        settings.check()?;
        Ok(settings)
    }

    pub(crate) fn render(&self) -> Result<String> {
        let body = toml::to_string_pretty(self)?;
        Ok(format!(
            "# Skywake deployment settings, read by `skywake deploy`.\n# No secrets live here: they stay in the target's secret store.\n\n{body}"
        ))
    }

    pub(crate) fn check(&self) -> Result<()> {
        let named = !self.name.is_empty()
            && self.name.len() <= 40
            && (self.name.chars())
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && !self.name.starts_with('-');
        if !named {
            bail!(
                "name `{}` must be 1 to 40 lowercase letters, digits or dashes",
                self.name
            );
        }
        if self.target == Target::Docker && self.host.is_none() {
            bail!("the docker target needs `host`, such as `host = \"me@203.0.113.7\"`");
        }
        if self.target == Target::Local && self.database == Database::Managed {
            bail!("a local deployment can't use a managed database: use `bundled` or `external`");
        }
        Ok(())
    }

    pub(crate) fn load(path: &Path) -> Result<Self> {
        let text =
            std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        Self::parse(&text).with_context(|| format!("in {}", path.display()))
    }

    pub(crate) fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, self.render()?).with_context(|| format!("writing {}", path.display()))
    }
}

pub(crate) fn root() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("SKYWAKE_DEPLOY_HOME").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let Some(home) = std::env::var_os("HOME").filter(|h| !h.is_empty()) else {
        bail!("no home folder to keep deployments in: set HOME or SKYWAKE_DEPLOY_HOME");
    };
    Ok(PathBuf::from(home).join(".skywake/deployments"))
}

pub(crate) fn folder(name: &str) -> Result<PathBuf> {
    Ok(root()?.join(name))
}

pub(crate) fn find(
    asked: Option<&Path>,
    name: Option<&str>,
) -> Result<Option<(PathBuf, Settings)>> {
    let candidates: Vec<PathBuf> = match (asked, name) {
        (Some(path), _) => vec![path.to_path_buf()],
        (None, Some(name)) => vec![PathBuf::from(FILE), folder(name)?.join(FILE)],
        (None, None) => {
            let mut found = vec![PathBuf::from(FILE)];
            found.extend(saved()?.into_iter().map(|(path, _)| path));
            found
        }
    };
    for path in candidates {
        if !path.exists() {
            continue;
        }
        let settings = Settings::load(&path)?;
        if name.is_none_or(|name| settings.name == name) {
            return Ok(Some((path, settings)));
        }
    }
    if let Some(path) = asked {
        bail!("no settings at {}", path.display());
    }
    Ok(None)
}

pub(crate) fn saved() -> Result<Vec<(PathBuf, Settings)>> {
    let root = root()?;
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path().join(FILE);
        if let Ok(settings) = Settings::load(&path) {
            found.push((path, settings));
        }
    }
    found.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip() {
        let mut settings = Settings::new("prod", Target::Aws, Size::Medium);
        settings.domain = Some("search.example.com".into());
        let text = settings.render().unwrap();
        assert!(text.contains("target = \"aws\""));
        assert!(text.contains("database = \"managed\""));
        assert_eq!(Settings::parse(&text).unwrap(), settings);
    }

    #[test]
    fn rejects_bad_settings() {
        let bad = |text: &str| Settings::parse(text).unwrap_err().to_string();
        assert!(bad("name = \"Prod\"\ntarget = \"local\"\nsize = \"tiny\"").contains("lowercase"));
        assert!(bad("name = \"a\"\ntarget = \"docker\"\nsize = \"tiny\"").contains("host"));
        assert!(bad("name = \"a\"\ntarget = \"moon\"\nsize = \"tiny\"").contains("moon"));
        assert!(
            bad("name = \"a\"\ntarget = \"local\"\nsize = \"tiny\"\nextra = 1").contains("extra")
        );
    }

    #[test]
    fn small_settings_parse_with_defaults() {
        let settings =
            Settings::parse("name = \"a\"\ntarget = \"local\"\nsize = \"tiny\"").unwrap();
        assert_eq!(settings.data_gb, 50);
        assert_eq!(settings.ports.api, 8080);
        assert_eq!(settings.database, Database::Bundled);
    }
}
