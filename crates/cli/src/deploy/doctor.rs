use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::Serialize;
use serde_json::{Value, json};

use super::detect::quiet;
use super::local::{Stack, api_url, free};
use super::settings::{Database, Settings, Target};
use super::ui::{Ui, bad, caution, dim, good, strong};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Ok,
    Warn,
    Fail,
    Skip,
}

#[derive(Debug, Serialize)]
pub(crate) struct Check {
    pub name: &'static str,
    pub status: Status,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

fn check(
    name: &'static str,
    status: Status,
    detail: impl Into<String>,
    fix: Option<&str>,
) -> Check {
    Check {
        name,
        status,
        detail: detail.into(),
        fix: fix.map(String::from),
    }
}

pub(crate) async fn run(ui: &Ui, settings: &Settings) -> Result<(Value, bool)> {
    let checks = match settings.target {
        Target::Local => local(settings).await,
        other => vec![check(
            "target",
            Status::Skip,
            format!("checks for {other} come with its deploy support"),
            None,
        )],
    };
    ui.header(&settings.name, &settings.target.to_string(), &dim("doctor"));
    ui.blank();
    for check in &checks {
        let mark = match check.status {
            Status::Ok => good("✔"),
            Status::Warn => caution("!"),
            Status::Fail => bad("✘"),
            Status::Skip => dim("–"),
        };
        ui.note(format!(
            "{mark} {} {}",
            strong(format!("{:<14}", check.name)),
            check.detail
        ));
        if let Some(fix) = &check.fix {
            ui.note(format!("  {} {fix}", dim("fix:")));
        }
    }
    let failed = checks.iter().filter(|c| c.status == Status::Fail).count();
    let warned = checks.iter().filter(|c| c.status == Status::Warn).count();
    ui.blank();
    match (failed, warned) {
        (0, 0) => ui.note(good("Everything looks right.")),
        (0, w) => ui.note(caution(format!(
            "{w} warning{}, nothing blocking.",
            plural(w)
        ))),
        (f, _) => ui.note(bad(format!("{f} problem{} to fix.", plural(f)))),
    }
    Ok((
        json!({ "name": settings.name, "checks": checks, "ok": failed == 0 }),
        failed == 0,
    ))
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

async fn local(settings: &Settings) -> Vec<Check> {
    let mut checks = Vec::new();
    let engine = quiet("docker", &["info", "--format", "{{.ServerVersion}}"]).await;
    let Some(engine) = engine.filter(|v| !v.is_empty()) else {
        checks.push(check(
            "docker",
            Status::Fail,
            "not running",
            Some("start Docker Desktop, or `sudo systemctl start docker`"),
        ));
        return checks;
    };
    checks.push(check(
        "docker",
        Status::Ok,
        format!("engine {engine}"),
        None,
    ));
    match quiet("docker", &["compose", "version", "--short"]).await {
        Some(version) => checks.push(check("compose", Status::Ok, format!("v{version}"), None)),
        None => checks.push(check(
            "compose",
            Status::Fail,
            "the compose plugin is missing",
            Some("install `docker-compose-plugin`"),
        )),
    }
    let stack = match Stack::of(settings) {
        Ok(stack) => stack,
        Err(error) => {
            checks.push(check("folder", Status::Fail, error.to_string(), None));
            return checks;
        }
    };
    let running = stack.running().await;
    checks.push(images(settings).await);
    if !running {
        let ports = settings.ports;
        let busy: Vec<String> = [ports.api, ports.console, ports.zero]
            .into_iter()
            .filter(|&port| !free(port))
            .map(|port| port.to_string())
            .collect();
        checks.push(match busy.is_empty() {
            true => check("ports", Status::Ok, "free", None),
            false => check(
                "ports",
                Status::Warn,
                format!("{} in use", busy.join(", ")),
                Some("`skywake deploy` picks the next free ones by itself"),
            ),
        });
        checks.push(check("services", Status::Skip, "not running", None));
        return checks;
    }
    checks.push(check("ports", Status::Ok, "serving", None));
    let api = api_url(settings);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build();
    let reply = match client {
        Ok(client) => client.get(format!("{api}/ready")).send().await.ok(),
        Err(_) => None,
    };
    match &reply {
        Some(reply) if reply.status().is_success() => {
            checks.push(check("api", Status::Ok, format!("ready at {api}"), None))
        }
        Some(reply) => checks.push(check(
            "api",
            Status::Fail,
            format!("answers {}", reply.status()),
            Some("`skywake deploy logs api` shows why"),
        )),
        None => checks.push(check(
            "api",
            Status::Fail,
            "no answer",
            Some("`skywake deploy logs api` shows why"),
        )),
    }
    checks.push(version(&api).await);
    checks.push(clock(reply.as_ref()));
    if settings.database != Database::External {
        checks.push(postgres(&stack).await);
    }
    checks
}

async fn version(api: &str) -> Check {
    let reply = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client.get(format!("{api}/v2/disks")).send().await.ok(),
        Err(_) => None,
    };
    let ours = env!("CARGO_PKG_VERSION");
    match reply.map(|r| r.status().as_u16()) {
        Some(404) => check(
            "api version",
            Status::Fail,
            format!("older than this CLI ({ours}): it has no /v2 routes"),
            Some("`skywake deploy upgrade` moves it to this CLI's release"),
        ),
        Some(_) => check(
            "api version",
            Status::Ok,
            format!("speaks /v2, like this CLI ({ours})"),
            None,
        ),
        None => check("api version", Status::Skip, "no answer", None),
    }
}

async fn images(settings: &Settings) -> Check {
    let images = &settings.images;
    if let Some(source) = &images.source {
        let memory: u64 = (quiet("docker", &["info", "--format", "{{.MemTotal}}"]).await)
            .and_then(|m| m.parse().ok())
            .unwrap_or(0);
        let gb = memory as f64 / 1e9;
        return match (super::build::is_checkout(source), gb >= 5.5 || memory == 0) {
            (false, _) => check(
                "images",
                Status::Fail,
                format!("{} isn't a Skywake checkout", source.display()),
                Some(
                    "run `skywake deploy --build` inside one, or `--pull` for the published images",
                ),
            ),
            (true, false) => check(
                "images",
                Status::Warn,
                format!("built from source, but Docker has only {gb:.1} GB of memory"),
                Some("give Docker 6 GB or more to build (Docker Desktop → Settings → Resources)"),
            ),
            (true, true) => check(
                "images",
                Status::Ok,
                format!("built from {}", super::ui::tilde(source)),
                None,
            ),
        };
    }
    let mut missing = Vec::new();
    for name in ["skywake-api", "skywake-console"] {
        let image = format!("{}/{name}:{}", images.registry, images.version);
        let local = quiet(
            "docker",
            &["image", "inspect", "--format", "{{.Id}}", &image],
        )
        .await;
        let remote = match local {
            Some(_) => true,
            None => quiet("docker", &["manifest", "inspect", &image])
                .await
                .is_some(),
        };
        if !remote {
            missing.push(image);
        }
    }
    match missing.is_empty() {
        true => check(
            "images",
            Status::Ok,
            format!("{}:{}", images.registry, images.version),
            None,
        ),
        false => check(
            "images",
            Status::Fail,
            format!("can't find {}", missing.join(", ")),
            Some(
                "set [images] registry and version in skywake.deploy.toml, or `docker login` to the registry",
            ),
        ),
    }
}

fn clock(reply: Option<&reqwest::Response>) -> Check {
    let date = (reply.and_then(|r| r.headers().get("date")))
        .and_then(|value| value.to_str().ok())
        .and_then(parse_http_date);
    let Some(theirs) = date else {
        return check("clock", Status::Skip, "the API sent no date", None);
    };
    let ours = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let skew = (ours - theirs).abs();
    match skew <= 5 {
        true => check("clock", Status::Ok, format!("{skew}s apart"), None),
        false => check(
            "clock",
            Status::Fail,
            format!("{skew}s apart"),
            Some("turn on time sync (NTP): signed bucket requests fail past 15 minutes"),
        ),
    }
}

pub(crate) fn parse_http_date(text: &str) -> Option<i64> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    let [_, day, month, year, time, _] = parts.as_slice() else {
        return None;
    };
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month = months.iter().position(|m| m == month)? as i64 + 1;
    let (day, year): (i64, i64) = (day.parse().ok()?, year.parse().ok()?);
    let clock: Vec<i64> = time.split(':').filter_map(|p| p.parse().ok()).collect();
    let [h, m, s] = clock.as_slice() else {
        return None;
    };
    let (y, mo) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * mo + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + m * 60 + s)
}

async fn postgres(stack: &Stack) -> Check {
    let query = [
        "psql",
        "-U",
        "skywake",
        "-tAc",
        "select current_setting('server_version_num') || ' ' || current_setting('wal_level')",
    ];
    let Some(reply) = stack.exec("postgres", &query).await else {
        return check(
            "postgres",
            Status::Fail,
            "no answer",
            Some("`skywake deploy logs postgres` shows why"),
        );
    };
    let mut parts = reply.split_whitespace();
    let version: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let wal = parts.next().unwrap_or_default().to_string();
    match (version >= 150_000, wal == "logical") {
        (true, true) => check(
            "postgres",
            Status::Ok,
            format!("{}, wal_level logical", version / 10_000),
            None,
        ),
        (false, _) => check(
            "postgres",
            Status::Fail,
            format!("version {} is too old", version / 10_000),
            Some("use Postgres 15 or newer"),
        ),
        (_, false) => check(
            "postgres",
            Status::Fail,
            format!("wal_level is {wal}"),
            Some(
                "set `wal_level = logical` and restart Postgres: the console follows changes through it",
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_http_dates() {
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(
            parse_http_date("Wed, 18 Nov 2026 10:30:05 GMT"),
            Some(1_794_997_805)
        );
        assert_eq!(parse_http_date("nonsense"), None);
    }
}
