use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{Context, Result, bail};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::detect::quiet;
use super::settings::Images;
use super::ui::Ui;

pub(crate) const REGISTRY: &str = "skywake.local";
const IMAGES: [(&str, &str); 2] = [
    ("skywake-api", "apps/api/Dockerfile"),
    ("skywake-console", "apps/console/Dockerfile"),
];

pub(crate) fn checkout() -> Option<PathBuf> {
    let start = std::env::current_dir().ok()?;
    start
        .ancestors()
        .find(|dir| is_checkout(dir))
        .map(Path::to_path_buf)
}

pub(crate) fn is_checkout(dir: &Path) -> bool {
    IMAGES.iter().all(|(_, file)| dir.join(file).exists())
        && dir.join("deploy/compose/compose.yaml").exists()
}

pub(crate) async fn tag(source: &Path) -> String {
    let dir = source.to_string_lossy();
    let commit = quiet("git", &["-C", &dir, "rev-parse", "--short=10", "HEAD"]).await;
    let dirty = quiet(
        "git",
        &["-C", &dir, "status", "--porcelain", "--untracked-files=no"],
    )
    .await
    .is_some_and(|changes| !changes.is_empty());
    match (commit, dirty) {
        (Some(commit), false) => format!("dev-{commit}"),
        (Some(commit), true) => format!("dev-{commit}-changed"),
        (None, _) => "dev".to_string(),
    }
}

pub(crate) async fn build(ui: &Ui, source: &Path, log: &Path) -> Result<Images> {
    if !is_checkout(source) {
        bail!(
            "{} isn't a Skywake checkout anymore: run from one, or pass --pull to use the published images",
            source.display()
        );
    }
    let version = tag(source).await;
    let mut written = Vec::new();
    for (name, file) in IMAGES {
        let image = format!("{REGISTRY}/{name}:{version}");
        let step = ui.step(&format!("build-{name}"), &format!("Building {name}"));
        let mut child = Command::new("docker")
            .arg("build")
            .arg("--progress=plain")
            .arg("--file")
            .arg(source.join(file))
            .arg("--tag")
            .arg(&image)
            .arg(source)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("running docker build")?;
        let mut lines = BufReader::new(child.stderr.take().expect("piped stderr")).lines();
        let mut tail: Vec<String> = Vec::new();
        while let Some(line) = lines.next_line().await? {
            if let Some(progress) = progress(&line) {
                step.message(&progress);
            }
            written.push(line.clone());
            tail.push(line);
            if tail.len() > 15 {
                tail.remove(0);
            }
        }
        let status = child.wait().await?;
        let _ = std::fs::write(log, written.join("\n"));
        if !status.success() {
            step.fail("");
            let hint = hint(&tail);
            bail!(
                "building {name} failed:\n{}{hint}\nfull log: {}",
                tail.join("\n"),
                log.display()
            );
        }
        step.done(&image);
    }
    Ok(Images {
        registry: REGISTRY.to_string(),
        version,
        source: Some(source.to_path_buf()),
    })
}

fn hint(tail: &[String]) -> &'static str {
    let seen = |needle: &str| tail.iter().any(|line| line.contains(needle));
    if seen("docker-credential") {
        "\nfix: ~/.docker/config.json names a credential helper (`credsStore`) that isn't installed: install it, or remove that line"
    } else if seen("killed") || seen("137") {
        "\nfix: Docker ran out of memory: give it 6 GB or more (Docker Desktop → Settings → Resources)"
    } else {
        ""
    }
}

fn progress(line: &str) -> Option<String> {
    let rest = line.strip_prefix('#')?;
    let (_, text) = rest.split_once(' ')?;
    let text = text.trim();
    let stage = text.strip_prefix('[')?;
    let (stage, command) = stage.split_once(']')?;
    let command: String = command.trim().chars().take(60).collect();
    Some(format!("{} {command}", stage.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_build_progress() {
        let line = "#12 [builder 4/9] RUN cargo build --release --locked -p skywake-node";
        assert_eq!(
            progress(line).unwrap(),
            "builder 4/9 RUN cargo build --release --locked -p skywake-node"
        );
        assert_eq!(progress("#12 DONE 3.1s"), None);
        assert_eq!(progress("plain text"), None);
    }

    #[test]
    fn finds_the_checkout_it_runs_in() {
        let root = checkout().expect("tests run inside the repository");
        assert!(is_checkout(&root));
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_checkout(dir.path()));
    }
}
