use std::collections::BTreeMap;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;

use super::settings::{Database, Settings, folder};
use super::ui::{Ui, accent, bad, caution, dim, good, strong, tilde};
use crate::credentials;

const COMPOSE: &str = include_str!("../../../../deploy/compose/compose.yaml");
const ROLES: &str = include_str!("../../../../deploy/compose/roles.sh");
const SECRETS: [&str; 9] = [
    "SKYWAKE_API_ADMIN_TOKEN",
    "BETTER_AUTH_SECRET",
    "ZERO_ADMIN_PASSWORD",
    "POSTGRES_PASSWORD",
    "API_DB_PASSWORD",
    "CONSOLE_DB_PASSWORD",
    "ZERO_DB_PASSWORD",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
];

pub(crate) struct Stack {
    pub dir: PathBuf,
    project: String,
}

#[derive(Default, Serialize, Deserialize)]
struct State {
    org: Option<String>,
    profile: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct Service {
    pub name: String,
    pub state: String,
    pub health: String,
}

impl Stack {
    pub(crate) fn of(settings: &Settings) -> Result<Self> {
        Ok(Self {
            dir: folder(&settings.name)?,
            project: format!("skywake-{}", settings.name),
        })
    }

    fn compose(&self, args: &[&str]) -> Command {
        let mut command = Command::new("docker");
        command
            .arg("compose")
            .arg("--project-name")
            .arg(&self.project)
            .arg("--project-directory")
            .arg(&self.dir)
            .arg("--file")
            .arg(self.dir.join("compose.yaml"))
            .args(args)
            .stdin(Stdio::null());
        command
    }

    async fn output(&self, args: &[&str]) -> Result<Output> {
        let output = self
            .compose(args)
            .output()
            .await
            .context("running docker compose")?;
        let mut log = Vec::new();
        log.extend_from_slice(format!("$ docker compose {}\n", args.join(" ")).as_bytes());
        log.extend_from_slice(&output.stdout);
        log.extend_from_slice(&output.stderr);
        let _ = std::fs::write(self.dir.join("last.log"), log);
        Ok(output)
    }

    async fn must(&self, args: &[&str]) -> Result<Output> {
        let output = self.output(args).await?;
        if !output.status.success() {
            let text = String::from_utf8_lossy(&output.stderr);
            let tail: Vec<&str> = text.lines().rev().take(12).collect();
            let tail: Vec<&str> = tail.into_iter().rev().collect();
            let fix = explain(&text, &self.dir)
                .map(|fix| format!("\nfix: {fix}"))
                .unwrap_or_default();
            bail!(
                "docker compose {} failed:\n{}{fix}\nfull log: {}",
                args.join(" "),
                tail.join("\n"),
                self.dir.join("last.log").display()
            );
        }
        Ok(output)
    }

    pub(crate) fn exists(&self) -> bool {
        self.dir.join("compose.yaml").exists()
    }

    pub(crate) async fn services(&self) -> Result<Vec<Service>> {
        if !self.exists() {
            return Ok(Vec::new());
        }
        let output = self.output(&["ps", "--all", "--format", "json"]).await?;
        let text = String::from_utf8_lossy(&output.stdout);
        let rows: Vec<Value> = match text.trim_start().starts_with('[') {
            true => serde_json::from_str(&text).unwrap_or_default(),
            false => text
                .lines()
                .filter_map(|line| serde_json::from_str(line).ok())
                .collect(),
        };
        let field = |row: &Value, name: &str| row[name].as_str().unwrap_or_default().to_string();
        let mut services: Vec<Service> = (rows.iter())
            .map(|row| Service {
                name: field(row, "Service"),
                state: field(row, "State"),
                health: field(row, "Health"),
            })
            .collect();
        services.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(services)
    }

    pub(crate) async fn running(&self) -> bool {
        (self.services().await.unwrap_or_default().iter())
            .any(|s| s.name == "api" && s.state == "running")
    }

    pub(crate) async fn exec(&self, service: &str, command: &[&str]) -> Option<String> {
        let mut args = vec!["exec", "-T", service];
        args.extend_from_slice(command);
        let output = self
            .compose(&args)
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub(crate) async fn stream(&self, args: &[&str]) -> Result<()> {
        let status = self
            .compose(args)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .context("running docker compose")?;
        match status.success() {
            true => Ok(()),
            false => bail!("docker compose {} failed", args.join(" ")),
        }
    }

    fn env(&self) -> BTreeMap<String, String> {
        read_env(&self.dir.join(".env"))
    }
}

pub(crate) fn explain(output: &str, dir: &Path) -> Option<String> {
    let known: [(&str, String); 5] = [
        (
            "bind source path does not exist",
            format!(
                "Docker can't see {}: share it in Docker Desktop (Settings → Resources → File sharing), or set SKYWAKE_DEPLOY_HOME to a folder under your home",
                dir.display()
            ),
        ),
        ("port is already allocated", "a port is taken: run `skywake deploy` again and it moves to free ones".into()),
        ("pull access denied", "the images aren't in that registry: set [images] registry in skywake.deploy.toml, or `docker login` first".into()),
        ("manifest unknown", "that image version doesn't exist: check [images] version in skywake.deploy.toml".into()),
        ("no space left on device", "Docker is out of disk: `docker system prune` frees space".into()),
    ];
    (known.into_iter())
        .find(|(pattern, _)| output.contains(pattern))
        .map(|(_, fix)| fix)
}

pub(crate) fn read_env(path: &Path) -> BTreeMap<String, String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    (text.lines())
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

pub(crate) fn render_env(settings: &Settings, old: &BTreeMap<String, String>) -> Result<String> {
    let random = SystemRandom::new();
    let secret = |name: &str| -> Result<String> {
        if let Some(kept) = old.get(name).filter(|value| !value.is_empty()) {
            return Ok(kept.clone());
        }
        let mut bytes = [0u8; 24];
        random
            .fill(&mut bytes)
            .map_err(|_| anyhow::anyhow!("no randomness for {name}"))?;
        Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
    };
    let ports = settings.ports;
    let mut profiles = Vec::new();
    if settings.database != Database::External {
        profiles.push("postgres");
    }
    if settings.bucket.is_none() {
        profiles.push("s3");
    }
    let mut lines = vec![
        "# Written by `skywake deploy`. Secrets live only here: keep this file private."
            .to_string(),
        format!("COMPOSE_PROFILES={}", profiles.join(",")),
        format!("SKYWAKE_REGISTRY={}", settings.images.registry),
        format!("SKYWAKE_VERSION={}", settings.images.version),
        format!("API_PORT={}", ports.api),
        format!("CONSOLE_PORT={}", ports.console),
        format!("ZERO_PORT={}", ports.zero),
        format!("API_URL=http://localhost:{}", ports.api),
        format!("CONSOLE_URL=http://localhost:{}", ports.console),
        format!("ZERO_URL=http://localhost:{}", ports.zero),
    ];
    match &settings.bucket {
        Some(bucket) => {
            lines.push(format!("SKYWAKE_STORE=s3://{bucket}"));
            if let Some(region) = &settings.region {
                lines.push(format!("AWS_REGION={region}"));
            }
            lines.push("AWS_ALLOW_HTTP=false".into());
            lines.push(format!(
                "AWS_ENDPOINT={}",
                old.get("AWS_ENDPOINT").cloned().unwrap_or_default()
            ));
        }
        None => {
            lines.push("SKYWAKE_STORE=s3://skywake".into());
            lines.push("AWS_REGION=us-east-1".into());
            lines.push("AWS_ENDPOINT=http://s3:9000".into());
        }
    }
    if settings.database == Database::External {
        let url = std::env::var("SKYWAKE_DATABASE_URL")
            .ok()
            .or_else(|| old.get("API_DATABASE_URL").cloned())
            .context("an external database needs SKYWAKE_DATABASE_URL")?;
        for name in [
            "API_DATABASE_URL",
            "CONSOLE_DATABASE_URL",
            "ZERO_DATABASE_URL",
        ] {
            lines.push(format!("{name}={url}"));
        }
    }
    for name in SECRETS {
        if settings.bucket.is_some() && name.starts_with("AWS_") {
            let kept = (old.get(name).cloned()).or_else(|| std::env::var(name).ok());
            if let Some(kept) = kept.filter(|value| !value.is_empty()) {
                lines.push(format!("{name}={kept}"));
            }
            continue;
        }
        lines.push(format!("{name}={}", secret(name)?));
    }
    Ok(lines.join("\n") + "\n")
}

fn write_private(path: &Path, text: &str) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(text.as_bytes())?;
        Ok(())
    }
    #[cfg(not(unix))]
    Ok(std::fs::write(path, text)?)
}

pub(crate) fn free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok() && TcpListener::bind(("0.0.0.0", port)).is_ok()
}

fn next_free(port: u16, taken: &[u16]) -> Option<u16> {
    (port..port.saturating_add(200)).find(|p| !taken.contains(p) && free(*p))
}

pub(crate) fn api_url(settings: &Settings) -> String {
    format!("http://localhost:{}", settings.ports.api)
}

pub(crate) fn console_url(settings: &Settings) -> String {
    format!("http://localhost:{}", settings.ports.console)
}

pub(crate) async fn apply(ui: &Ui, settings: &mut Settings, settings_path: &Path) -> Result<Value> {
    let stack = Stack::of(settings)?;
    std::fs::create_dir_all(&stack.dir)?;

    let step = ui.step("docker", "Checking Docker");
    let version = super::detect::quiet("docker", &["info", "--format", "{{.ServerVersion}}"]).await;
    let compose = super::detect::quiet("docker", &["compose", "version", "--short"]).await;
    match (version, compose) {
        (Some(engine), Some(compose)) => step.done(format!("engine {engine}, compose {compose}")),
        (None, _) => {
            step.fail("not running");
            bail!(
                "Docker isn't running: start Docker Desktop (or `sudo systemctl start docker`), then run this again"
            );
        }
        (_, None) => {
            step.fail("no compose plugin");
            bail!("Docker Compose v2 is missing: install the `docker-compose-plugin` package");
        }
    }

    let step = ui.step("ports", "Choosing ports");
    let ours = stack.running().await;
    let mut moved = Vec::new();
    if !ours {
        let mut taken = Vec::new();
        for (label, port) in [
            ("api", &mut settings.ports.api),
            ("console", &mut settings.ports.console),
            ("zero", &mut settings.ports.zero),
        ] {
            let chosen = next_free(*port, &taken).context("no free port nearby")?;
            if chosen != *port {
                moved.push(format!("{label} {} → {chosen}", *port));
                *port = chosen;
            }
            taken.push(chosen);
        }
    }
    settings.save(settings_path)?;
    let ports = settings.ports;
    let detail = match moved.is_empty() {
        true => format!(
            "api {}, console {}, zero {}",
            ports.api, ports.console, ports.zero
        ),
        false => format!("moved {}", moved.join(", ")),
    };
    step.done(detail);

    let step = ui.step("files", "Writing settings and secrets");
    std::fs::write(stack.dir.join("compose.yaml"), COMPOSE)?;
    std::fs::write(stack.dir.join("roles.sh"), ROLES)?;
    let env = render_env(settings, &stack.env())?;
    write_private(&stack.dir.join(".env"), &env)?;
    step.done(dim(tilde(&stack.dir)));

    if let Some(source) = settings.images.source.clone() {
        let built = super::build::build(ui, &source, &stack.dir.join("build.log")).await?;
        let mut running = settings.clone();
        running.images = built;
        write_private(
            &stack.dir.join(".env"),
            &render_env(&running, &stack.env())?,
        )?;
    }

    let step = ui.step("start", "Starting services");
    step.message("first run downloads the images");
    if let Err(error) = stack
        .must(&[
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "300",
            "--remove-orphans",
        ])
        .await
    {
        step.fail("");
        return Err(error.context(
            "the services didn't come up: `skywake deploy logs` shows why, `skywake deploy doctor` checks the usual causes",
        ));
    }
    step.done(format!("{} services", stack.services().await?.len()));

    let step = ui.step("ready", "Waiting for the API");
    let api = api_url(settings);
    if let Err(error) = wait_ready(&api).await {
        step.fail("");
        return Err(error);
    }
    step.done(dim(&api));

    let state_path = stack.dir.join("deployment.json");
    let mut state: State = std::fs::read(&state_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let profile = state
        .profile
        .clone()
        .unwrap_or_else(|| settings.name.clone());
    let saved = credentials::load()
        .get(&profile)
        .and_then(|p| p.get("key"))
        .is_some();
    let mut key_made = false;
    if state.org.is_none() || !saved {
        let step = ui.step("org", "Making your organization and key");
        let token = stack
            .env()
            .get("SKYWAKE_API_ADMIN_TOKEN")
            .cloned()
            .unwrap_or_default();
        let (org, key) = match create_org(&api, &token, &settings.name).await {
            Ok(made) => made,
            Err(error) => {
                step.fail("");
                return Err(error);
            }
        };
        let mut profiles = credentials::load();
        let entry = profiles.entry(profile.clone()).or_default();
        entry.insert("url".into(), api.clone());
        entry.insert("key".into(), key);
        credentials::store(&profiles)?;
        state.org = Some(org.clone());
        state.profile = Some(profile.clone());
        std::fs::write(&state_path, serde_json::to_vec_pretty(&state)?)?;
        key_made = true;
        step.done(format!("{org} · key saved to profile `{profile}`"));
    }

    Ok(json!({
        "name": settings.name,
        "target": "local",
        "console": console_url(settings),
        "api": api,
        "profile": profile,
        "org": state.org,
        "new_key": key_made,
        "folder": stack.dir,
        "settings": settings_path,
    }))
}

async fn wait_ready(api: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?;
    let url = format!("{api}/ready");
    for _ in 0..120 {
        if client
            .get(&url)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    bail!("the API at {api} wasn't ready after two minutes: `skywake deploy logs api` shows why")
}

async fn create_org(api: &str, token: &str, name: &str) -> Result<(String, String)> {
    let response = reqwest::Client::new()
        .post(format!("{api}/v1/orgs"))
        .bearer_auth(token)
        .json(&json!({ "name": name }))
        .send()
        .await
        .context("calling the API to make the organization")?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or_default();
    if status.as_u16() == 409 {
        bail!(
            "an organization named `{name}` already exists here but its key isn't saved: sign in to the console and make a key, then `skywake login --paste --profile {name}`"
        );
    }
    if !status.is_success() {
        bail!("the API refused to make the organization ({status}): {body}");
    }
    let org = body["id"]
        .as_str()
        .context("no organization id in the reply")?;
    let key = body["key"].as_str().context("no key in the reply")?;
    Ok((org.to_string(), key.to_string()))
}

pub(crate) async fn status(ui: &Ui, settings: &Settings) -> Result<Value> {
    let stack = Stack::of(settings)?;
    let services = stack.services().await?;
    let api = api_url(settings);
    let ready = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()?
        .get(format!("{api}/ready"))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success());
    let state = match (services.is_empty(), ready) {
        (true, _) => "not deployed",
        (false, true) => "running",
        (false, false) => match services.iter().any(|s| s.state == "running") {
            true => "starting or unhealthy",
            false => "stopped",
        },
    };
    let painted = match state {
        "running" => good(state),
        "not deployed" => dim(state),
        "stopped" => caution(state),
        _ => bad(state),
    };
    ui.header(&settings.name, "local", &painted);
    if !services.is_empty() {
        ui.blank();
        for service in &services {
            let dot = match (service.state.as_str(), service.health.as_str()) {
                ("running", "healthy" | "") => good("●"),
                ("running", _) => caution("●"),
                ("exited", _) if matches!(service.name.as_str(), "roles" | "bucket") => dim("○"),
                _ => bad("●"),
            };
            let health = match service.health.is_empty() {
                true => String::new(),
                false => dim(format!("({})", service.health)),
            };
            ui.note(format!(
                "{dot} {} {} {health}",
                strong(format!("{:<9}", service.name)),
                service.state
            ));
        }
        ui.blank();
        ui.rows(&[
            ("console", accent(console_url(settings))),
            ("api", accent(&api)),
            ("files", dim(tilde(&stack.dir))),
        ]);
    }
    if state == "not deployed" {
        ui.hint("`skywake deploy` starts it");
    } else if state == "stopped" {
        ui.hint("`skywake deploy` starts it again; the data is kept");
    }
    Ok(
        json!({ "name": settings.name, "state": state, "api": api, "console": console_url(settings), "services": services }),
    )
}

pub(crate) async fn logs(
    settings: &Settings,
    service: Option<&str>,
    follow: bool,
    lines: u32,
) -> Result<()> {
    let stack = Stack::of(settings)?;
    if !stack.exists() {
        bail!("`{}` isn't deployed here yet", settings.name);
    }
    let tail = lines.to_string();
    let mut args = vec!["logs", "--tail", tail.as_str(), "--timestamps"];
    if follow {
        args.push("--follow");
    }
    args.extend(service);
    stack.stream(&args).await
}

pub(crate) async fn stop(ui: &Ui, settings: &Settings) -> Result<Value> {
    let stack = Stack::of(settings)?;
    let step = ui.step("stop", "Stopping services");
    stack.must(&["stop"]).await?;
    step.done("data kept");
    Ok(json!({ "name": settings.name, "state": "stopped" }))
}

pub(crate) async fn upgrade(ui: &Ui, settings: &Settings) -> Result<Value> {
    let stack = Stack::of(settings)?;
    if !stack.exists() {
        bail!(
            "`{}` isn't deployed here yet: `skywake deploy` makes it",
            settings.name
        );
    }
    std::fs::write(stack.dir.join("compose.yaml"), COMPOSE)?;
    std::fs::write(stack.dir.join("roles.sh"), ROLES)?;
    let step = ui.step("pull", "Fetching the new images");
    stack
        .must(&["pull", "--ignore-buildable", "--quiet"])
        .await?;
    step.done(&settings.images.version);
    let step = ui.step("roll", "Restarting on the new version");
    stack
        .must(&[
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "300",
            "--remove-orphans",
        ])
        .await?;
    step.done("");
    let step = ui.step("ready", "Waiting for the API");
    wait_ready(&api_url(settings)).await?;
    step.done("");
    Ok(json!({ "name": settings.name, "state": "running", "version": settings.images.version }))
}

pub(crate) async fn destroy(ui: &Ui, settings: &Settings) -> Result<Value> {
    let stack = Stack::of(settings)?;
    let step = ui.step("down", "Removing containers and volumes");
    if stack.exists() {
        stack
            .must(&["down", "--volumes", "--remove-orphans"])
            .await?;
    }
    step.done("");
    let step = ui.step("files", "Removing settings, secrets and the saved key");
    let state: State = std::fs::read(stack.dir.join("deployment.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if let Some(profile) = state.profile {
        let mut profiles = credentials::load();
        if profiles.remove(&profile).is_some() {
            credentials::store(&profiles)?;
        }
    }
    if stack.dir.exists() {
        std::fs::remove_dir_all(&stack.dir)?;
    }
    step.done("");
    Ok(json!({ "name": settings.name, "state": "destroyed" }))
}

pub(crate) fn doomed(settings: &Settings) -> Result<Vec<String>> {
    let stack = Stack::of(settings)?;
    Ok(vec![
        format!("the containers of `{}`", stack.project),
        "its Postgres and S3 volumes: every disk and key in it".into(),
        format!("{} (settings and secrets)", tilde(&stack.dir)),
        format!("the `{}` profile's saved key", settings.name),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deploy::settings::{Size, Target};

    #[test]
    fn env_keeps_secrets_across_runs() {
        let settings = Settings::new("dev", Target::Local, Size::Tiny);
        let first = render_env(&settings, &BTreeMap::new()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        std::fs::write(&path, &first).unwrap();
        let old = read_env(&path);
        assert_eq!(old["SKYWAKE_API_ADMIN_TOKEN"].len(), 48);
        assert_eq!(old["COMPOSE_PROFILES"], "postgres,s3");
        let second = render_env(&settings, &old).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn env_uses_your_bucket() {
        let mut settings = Settings::new("dev", Target::Local, Size::Tiny);
        settings.bucket = Some("mine".into());
        let env = render_env(&settings, &BTreeMap::new()).unwrap();
        assert!(env.contains("COMPOSE_PROFILES=postgres\n"));
        assert!(env.contains("SKYWAKE_STORE=s3://mine"));
        assert!(!env.contains("AWS_SECRET_ACCESS_KEY="));
    }

    #[test]
    fn finds_the_next_free_port() {
        let held = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        let next = next_free(port, &[]).unwrap();
        assert_ne!(next, port);
        assert!(next > port);
    }
}
