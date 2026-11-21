use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;
use skywake::{ErrorKind, Role, Skywake};

struct Cli {
    url: String,
    key: String,
    admin: String,
    home: tempfile::TempDir,
}

impl Cli {
    fn run(&self, args: &[&str], stdin: Option<&str>) -> (bool, String, String) {
        let mut child = Command::new(env!("CARGO_BIN_EXE_skywake"))
            .args(args)
            .current_dir(self.home.path())
            .env("SKYWAKE_URL", &self.url)
            .env("SKYWAKE_API_KEY", &self.key)
            .env("HOME", self.home.path())
            .env("XDG_CONFIG_HOME", self.home.path().join("config"))
            .env("SKYWAKE_ROOT", self.home.path().join("root"))
            .env_remove("SKYWAKE_KEY")
            .env_remove("SKYWAKE_ENV")
            .env_remove("SKYWAKE_PROFILE")
            .env_remove("SKYWAKE_STORE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        input
            .write_all(stdin.unwrap_or_default().as_bytes())
            .unwrap();
        drop(input);
        let out = child.wait_with_output().unwrap();
        let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).to_string();
        (out.status.success(), text(&out.stdout), text(&out.stderr))
    }

    fn ok(&self, args: &[&str]) -> String {
        self.ok_with(args, None)
    }

    fn ok_with(&self, args: &[&str], stdin: Option<&str>) -> String {
        let (ok, out, error) = self.run(args, stdin);
        assert!(ok, "skywake {args:?} failed: {error}{out}");
        out
    }

    fn fails(&self, args: &[&str]) -> String {
        let (ok, out, error) = self.run(args, None);
        assert!(!ok, "skywake {args:?} should fail: {out}");
        error
    }

    fn json(&self, args: &[&str]) -> Value {
        let out = self.ok(&[args, &["--json"]].concat());
        serde_json::from_str(&out).unwrap_or_else(|_| panic!("not JSON from {args:?}: {out}"))
    }

    fn file(&self, name: &str, text: &str) -> String {
        let path = self.home.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path.to_str().unwrap().to_string()
    }

    fn path(&self, name: &str) -> PathBuf {
        self.home.path().join(name)
    }
}

async fn cli() -> Option<Cli> {
    let (Ok(url), Ok(admin)) = (
        std::env::var("SKYWAKE_SCENARIO_URL"),
        std::env::var("SKYWAKE_SCENARIO_KEY"),
    ) else {
        eprintln!("skipped: set SKYWAKE_SCENARIO_URL and SKYWAKE_SCENARIO_KEY to run it");
        return None;
    };
    let org = Skywake::builder().url(&url).key(&admin).build().unwrap();
    match org.create_environment("prod").await {
        Err(error) if error.kind() == Some(&ErrorKind::Conflict) => {}
        done => drop(done.unwrap()),
    }
    let key = org
        .create_key("cli", Role::Admin)
        .environment("prod")
        .await
        .unwrap()
        .key;
    Some(Cli {
        url,
        key,
        admin,
        home: tempfile::tempdir().unwrap(),
    })
}

fn eventually(mut check: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(20) {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn same_files(left: &Path, right: &Path, name: &str) {
    assert_eq!(
        std::fs::read_to_string(left.join(name)).unwrap(),
        std::fs::read_to_string(right.join(name)).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn scenarios() {
    let Some(cli) = cli().await else { return };
    account(&cli);
    disk_files(&cli);
    disk_branches(&cli);
    folders(&cli);
    disk_query(&cli);
    keys(&cli);
    destroy(&cli);
}

fn account(cli: &Cli) {
    assert!(cli.ok(&["whoami"]).contains("environment `prod`"));
    assert_eq!(cli.json(&["whoami"])["environment"], "prod");
    assert_eq!(cli.ok(&["env"]).trim(), "prod");

    let out = cli.ok(&["login", "--key", &cli.key, "--profile", "work"]);
    assert!(out.contains("profile `work`"), "{out}");
    let saved = std::fs::read_to_string(cli.path("config/skywake/credentials.toml")).unwrap();
    assert!(saved.contains("[work]"), "{saved}");
    assert!(
        cli.ok(&["env", "staging", "--profile", "work"])
            .contains("staging")
    );
    assert!(
        cli.ok(&["logout", "--profile", "work"])
            .contains("Signed out")
    );
}

fn disk_files(cli: &Cli) {
    assert!(
        cli.ok_with(
            &["write", "app/notes.md", "-m", "add notes"],
            Some("hello\nworld\n")
        )
        .contains("wrote app")
    );
    let other = cli.file("todo.md", "ship it\n");
    cli.ok(&["write", "app/docs/todo.md", &other]);
    assert_eq!(cli.ok(&["read", "app/notes.md"]), "hello\nworld\n");
    assert_eq!(cli.ok(&["cat", "app/docs/todo.md"]), "ship it\n");

    let listed = cli.ok(&["ls", "app"]);
    assert!(
        listed.contains("notes.md") && listed.contains("docs/"),
        "{listed}"
    );
    let deep = cli.json(&["list", "app", "--recursive"]);
    let paths: Vec<&str> = deep
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entry| entry["path"].as_str())
        .collect();
    assert!(paths.contains(&"docs/todo.md"), "{paths:?}");

    assert_eq!(cli.ok(&["grep", "world", "app"]).trim(), "notes.md:2:world");
    assert!(
        cli.ok(&["find", "*.md", "app/docs"])
            .contains("docs/todo.md")
    );
    assert!(cli.ok(&["disks"]).contains("app"));

    let error = cli.fails(&["read", "app/missing.md"]);
    assert!(
        error.to_lowercase().contains("not found") || error.contains("missing.md"),
        "{error}"
    );
    let error = cli.fails(&["read", "app"]);
    assert!(error.contains("needs a file path"), "{error}");
}

fn disk_branches(cli: &Cli) {
    cli.ok(&["fork", "app", "agent-1"]);
    cli.ok_with(&["write", "app@agent-1/notes.md"], Some("changed\n"));
    assert_eq!(cli.ok(&["diff", "app@agent-1"]).trim(), "~ notes.md");
    assert!(
        cli.ok(&["merge", "app@agent-1", "-m", "take it"])
            .contains("→ main")
    );
    assert_eq!(cli.ok(&["read", "app/notes.md"]), "changed\n");
    assert!(
        cli.fails(&["merge", "app"])
            .contains("name the branch to merge")
    );
    assert!(
        cli.ok(&["log", "app", "--path", "notes.md"])
            .contains("take it")
    );

    cli.ok(&["fork", "app", "one"]);
    cli.ok(&["fork", "app", "two"]);
    cli.ok_with(&["write", "app@one/notes.md"], Some("one\n"));
    cli.ok_with(&["write", "app@two/notes.md"], Some("two\n"));
    cli.ok(&["merge", "app@one"]);
    let error = cli.fails(&["merge", "app@two"]);
    assert!(
        error.contains("conflict: notes.md") && error.contains("nothing was merged"),
        "{error}"
    );

    assert!(
        cli.ok(&["delete", "app/docs/todo.md", "-m", "done"])
            .contains("deleted docs/todo.md")
    );
    assert!(!cli.fails(&["read", "app/docs/todo.md"]).is_empty());
    assert!(
        cli.ok(&["destroy", "app@two", "--yes"])
            .contains("branch two")
    );
    let branches = cli.ok(&["branches", "app"]);
    assert!(
        branches.contains("agent-1") && !branches.contains("two"),
        "{branches}"
    );
}

fn folders(cli: &Cli) {
    cli.file("site/index.html", "<h1>hi</h1>\n");
    cli.file("site/css/main.css", "body {}\n");
    let site = cli.path("site");
    assert!(
        cli.fails(&["upload", site.to_str().unwrap(), "app@site"])
            .contains("does not exist")
    );
    cli.ok(&["fork", "app", "site"]);
    assert!(
        cli.ok(&["upload", site.to_str().unwrap(), "app@site", "-m", "site"])
            .contains("uploaded")
    );
    let copy = cli.path("copy");
    assert!(
        cli.ok(&["download", "app@site", copy.to_str().unwrap()])
            .contains("downloaded")
    );
    same_files(&site, &copy, "index.html");
    same_files(&site, &copy, "css/main.css");
}

fn disk_query(cli: &Cli) {
    assert!(
        cli.ok(&["create", "disk", "docs", "--search"])
            .contains("Made disk docs")
    );
    cli.ok_with(
        &["write", "docs/auth.md"],
        Some("Sign in happens in the auth service with tokens.\n"),
    );
    let found = eventually(|| {
        let (ok, out, _) = cli.run(&["query", "docs", "auth service", "--json"], None);
        ok && out.contains("auth.md")
    });
    assert!(found, "the disk query never found auth.md");
    assert!(cli.fails(&["query", "docs"]).contains("needs words"));
}

fn keys(cli: &Cli) {
    let org = ["--key", cli.admin.as_str(), "--env", "prod"];
    let made = cli.json(
        &[
            &[
                "keys", "create", "--role", "read", "--name", "reader", "--only", "app",
            ][..],
            &org,
        ]
        .concat(),
    );
    let id = made["id"].as_str().unwrap().to_string();
    assert!(made["key"].as_str().unwrap().len() > 10);
    let listed = cli.ok(&[&["keys"][..], &org].concat());
    assert!(
        listed.contains("reader") && listed.contains("prod"),
        "{listed}"
    );
    assert!(
        cli.fails(&[&["keys", "revoke", &id][..], &org].concat())
            .contains("--yes")
    );
    assert!(
        cli.ok(&[&["keys", "revoke", &id, "--yes"][..], &org].concat())
            .contains("Revoked")
    );
    assert!(!cli.ok(&[&["keys"][..], &org].concat()).contains("reader"));
}

fn destroy(cli: &Cli) {
    assert!(cli.fails(&["destroy", "app"]).contains("--yes"));
    assert!(
        cli.fails(&["destroy", "nothing-here", "--yes"])
            .contains("no disk named")
    );
    for name in ["app", "docs"] {
        cli.ok(&["destroy", name, "--yes"]);
    }
    assert_eq!(cli.json(&["disks"]), Value::Array(vec![]));
}
