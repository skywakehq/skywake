use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

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

fn ids(hits: &Value) -> Vec<i64> {
    hits.as_array()
        .unwrap()
        .iter()
        .filter_map(|hit| hit["id"].as_i64())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn scenarios() {
    let Some(cli) = cli().await else { return };
    account(&cli);
    index_rows(&cli);
    index_branches(&cli);
    keys(&cli);
    types(&cli);
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

fn index_rows(cli: &Cli) {
    let schema = cli.file(
        "schema.json",
        r#"{"attributes": [{"name": "title", "type": "text"}, {"name": "price", "type": "number"}, {"name": "tag", "type": "string"}]}"#,
    );
    assert!(
        cli.ok(&[
            "create",
            "index",
            "products",
            "--schema",
            &schema,
            "--no-embed"
        ])
        .contains("Made index products")
    );
    let csv = cli.file(
        "rows.csv",
        "id,title,price,tag\n1,Desk lamp,40,home\n2,Red mug,9,kitchen\n",
    );
    assert!(
        cli.ok(&["upsert", "products", &csv])
            .contains("wrote 2 rows")
    );
    let lines = "{\"id\": 3, \"title\": \"Floor lamp\", \"price\": 120, \"tag\": \"home\"}\n";
    assert_eq!(
        cli.json(&["upsert", "products", "-"])["count"],
        0,
        "an empty stdin writes nothing"
    );
    assert!(
        cli.ok_with(&["upsert", "products", "-"], Some(lines))
            .contains("wrote 1 rows")
    );

    let row: Value = serde_json::from_str(&cli.ok(&["get", "products", "1"])).unwrap();
    assert_eq!(row["title"], "Desk lamp");
    assert_eq!(row["price"], 40.0);
    assert!(
        cli.fails(&["get", "products", "99"])
            .contains("no row `99`")
    );

    let hits = cli.json(&[
        "query",
        "products",
        "lamp",
        "--mode",
        "keywords",
        "--filter",
        "price < 100",
    ]);
    assert_eq!(ids(&hits), vec![1]);
    let sorted = cli.json(&["query", "products", "--sort", "price:desc", "--limit", "2"]);
    assert_eq!(ids(&sorted), vec![3, 1]);
    let table = cli.ok(&["query", "products", "--filter", "tag = kitchen"]);
    assert!(
        table.contains("Red mug") && table.starts_with("ID"),
        "{table}"
    );
    assert!(cli.ok(&["indexes"]).contains("products"));
}

fn index_branches(cli: &Cli) {
    assert!(
        cli.ok(&["fork", "products", "try"])
            .contains("products@try")
    );
    assert!(
        cli.ok(&["delete", "products@try", "2"])
            .contains("deleted 1 rows")
    );
    assert!(cli.ok(&["get", "products", "2"]).contains("Red mug"));
    let branches = cli.json(&["branches", "products"]);
    let names: Vec<&str> = branches
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|branch| branch["name"].as_str())
        .collect();
    assert!(
        names.contains(&"main") && names.contains(&"try"),
        "{names:?}"
    );
    assert!(cli.ok(&["merge", "products@try"]).contains("→ main"));
    assert!(cli.fails(&["get", "products", "2"]).contains("no row"));
    assert!(!cli.ok(&["log", "products"]).trim().is_empty());
    assert!(
        cli.fails(&["merge", "products"])
            .contains("name the branch to merge")
    );
}

fn keys(cli: &Cli) {
    let org = ["--key", cli.admin.as_str(), "--env", "prod"];
    let made = cli.json(
        &[
            &[
                "keys", "create", "--role", "read", "--name", "reader", "--only", "products",
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

fn types(cli: &Cli) {
    let out = cli.path("skywake.d.ts");
    assert!(
        cli.ok(&["types", "-o", out.to_str().unwrap()])
            .contains("1 indexes")
    );
    let text = std::fs::read_to_string(out).unwrap();
    assert!(text.contains("interface IndexRows"), "{text}");
    assert!(
        text.contains("products: { title?: string; price?: number; tag?: string };"),
        "{text}"
    );
}

fn destroy(cli: &Cli) {
    assert!(cli.fails(&["destroy", "products"]).contains("--yes"));
    cli.fails(&["destroy", "nothing-here", "--yes"]);
    cli.ok(&["destroy", "products", "--yes"]);
    assert_eq!(cli.json(&["indexes"]), Value::Array(vec![]));
}
