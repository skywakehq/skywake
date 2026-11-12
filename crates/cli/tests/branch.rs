//! `skywake checkout` and `commit` through a running API (needs SKYWAKE_URL
//! and SKYWAKE_API_ADMIN_TOKEN).

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use serde_json::{Value, json};

struct Cli {
    url: String,
    key: String,
}

impl Cli {
    fn run(&self, args: &[&str]) -> (bool, String) {
        let out = Command::new(env!("CARGO_BIN_EXE_skywake"))
            .args(args)
            .env("SKYWAKE_URL", &self.url)
            .env("SKYWAKE_KEY", &self.key)
            .env("SKYWAKE_NAMESPACE", "test/app")
            .env_remove("SKYWAKE_STORE")
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout).to_string()
            + &String::from_utf8_lossy(&out.stderr);
        (out.status.success(), text)
    }

    fn ok(&self, args: &[&str]) -> String {
        let (ok, text) = self.run(args);
        assert!(ok, "skywake {args:?} failed: {text}");
        text
    }

    async fn post(&self, path: &str, body: Value) -> Value {
        reqwest::Client::new()
            .post(format!("{}/v1{path}", self.url))
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap()
    }
}

async fn cli() -> Option<Cli> {
    let (Ok(url), Ok(admin)) = (
        std::env::var("SKYWAKE_URL"),
        std::env::var("SKYWAKE_API_ADMIN_TOKEN"),
    ) else {
        eprintln!("skipped: set SKYWAKE_URL and SKYWAKE_API_ADMIN_TOKEN to run it");
        return None;
    };
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let made: Value = reqwest::Client::new()
        .post(format!("{url}/v1/orgs"))
        .bearer_auth(admin)
        .json(&json!({ "name": format!("cli-{nanos}") }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let key = made["key"].as_str().unwrap().to_string();
    Some(Cli { url, key })
}

/// Every path under `dir` but the checkout file, with its bytes and mode.
fn contents(dir: &Path) -> Vec<(String, Vec<u8>, bool)> {
    let mut found = Vec::new();
    let mut folders = vec![dir.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for item in std::fs::read_dir(&folder).unwrap() {
            let path = item.unwrap().path();
            let name = path
                .strip_prefix(dir)
                .unwrap()
                .to_string_lossy()
                .to_string();
            if name == ".skywake-checkout" {
                continue;
            }
            let meta = std::fs::metadata(&path).unwrap();
            if meta.is_dir() {
                folders.push(path);
                found.push((name + "/", Vec::new(), false));
            } else {
                let executable = meta.permissions().mode() & 0o111 != 0;
                found.push((name, std::fs::read(&path).unwrap(), executable));
            }
        }
    }
    found.sort();
    found
}

#[tokio::test(flavor = "multi_thread")]
async fn checkout_and_commit_through_the_api() {
    let Some(cli) = cli().await else { return };
    cli.post("/namespaces", json!({ "name": "test/app" })).await;
    cli.post("/namespaces/test%2Fapp/branches", json!({ "name": "main" }))
        .await;

    // A folder never checked out: everything in it is sent.
    let work = tempfile::tempdir().unwrap();
    let source = work.path().join("source");
    std::fs::create_dir_all(source.join("nested/deeper")).unwrap();
    std::fs::create_dir_all(source.join("empty")).unwrap();
    std::fs::write(source.join("a.txt"), "hello\n").unwrap();
    std::fs::write(source.join("nested/deeper/x.txt"), "x").unwrap();
    std::fs::write(source.join("blank"), "").unwrap();
    let binary: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    std::fs::write(source.join("bytes.bin"), &binary).unwrap();
    // Over one part, so it goes up in two.
    let large: Vec<u8> = (0..17 * 1024 * 1024u32)
        .map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8)
        .collect();
    std::fs::write(source.join("large.bin"), &large).unwrap();
    std::fs::write(source.join("run.sh"), "#!/bin/sh\necho hi\n").unwrap();
    std::fs::set_permissions(source.join("run.sh"), PermissionsExt::from_mode(0o755)).unwrap();
    let out = cli.ok(&["commit", "main", source.to_str().unwrap(), "-m", "first"]);
    assert!(out.starts_with("main → "), "{out}");
    let out = cli.ok(&["commit", "main", source.to_str().unwrap()]);
    assert_eq!(out, "main: nothing changed\n");

    // An agent forks main, checks it out, changes it and commits.
    cli.post(
        "/namespaces/test%2Fapp/branches",
        json!({ "name": "agents/one", "from": "main" }),
    )
    .await;
    let copy = work.path().join("copy");
    cli.ok(&["checkout", "agents/one", copy.to_str().unwrap()]);
    assert_eq!(contents(&copy), contents(&source));

    std::fs::write(copy.join("a.txt"), "changed\n").unwrap();
    std::fs::remove_dir_all(copy.join("nested")).unwrap();
    std::fs::write(copy.join("new.txt"), "new").unwrap();
    std::fs::set_permissions(copy.join("run.sh"), PermissionsExt::from_mode(0o644)).unwrap();
    let out = cli.ok(&["commit", "agents/one", copy.to_str().unwrap(), "-m", "work"]);
    assert!(out.starts_with("agents/one → "), "{out}");
    let out = cli.ok(&["commit", "agents/one", copy.to_str().unwrap()]);
    assert_eq!(out, "agents/one: nothing changed\n");

    let again = work.path().join("again");
    cli.ok(&["checkout", "agents/one", again.to_str().unwrap()]);
    assert_eq!(contents(&again), contents(&copy));
    let main = work.path().join("main");
    cli.ok(&["checkout", "main", main.to_str().unwrap()]);
    assert_eq!(contents(&main), contents(&source));

    // The folder belongs to its branch, and checkout needs an empty folder.
    let (ok, out) = cli.run(&["commit", "main", copy.to_str().unwrap()]);
    assert!(
        !ok && out.contains("checked out from test/app agents/one"),
        "{out}"
    );
    let (ok, out) = cli.run(&["checkout", "main", copy.to_str().unwrap()]);
    assert!(!ok && out.contains("is not empty"), "{out}");
}
