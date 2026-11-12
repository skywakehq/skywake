//! `skywake index` against a running API (needs SKYWAKE_URL and SKYWAKE_API_ADMIN_TOKEN).

use std::io::Write;
use std::process::{Command, Output, Stdio};

use serde_json::{Value, json};

struct Cli {
    url: String,
    key: String,
}

impl Cli {
    fn run(&self, args: &[&str], stdin: Option<&str>) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_skywake"))
            .arg("index")
            .args(args)
            .env("SKYWAKE_URL", &self.url)
            .env("SKYWAKE_KEY", &self.key)
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
        child.wait_with_output().unwrap()
    }

    fn ok(&self, args: &[&str]) -> String {
        self.ok_with(args, None)
    }

    fn ok_with(&self, args: &[&str], stdin: Option<&str>) -> String {
        let out = self.run(args, stdin);
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let error = String::from_utf8_lossy(&out.stderr);
        assert!(
            out.status.success(),
            "skywake index {args:?} failed: {error}"
        );
        text
    }

    fn json(&self, args: &[&str]) -> Value {
        let args = [args, &["--json"]].concat();
        serde_json::from_str(&self.ok(&args)).unwrap()
    }

    fn fails(&self, args: &[&str], stdin: Option<&str>) -> String {
        let out = self.run(args, stdin);
        assert!(!out.status.success(), "skywake index {args:?} should fail");
        String::from_utf8_lossy(&out.stderr).to_string()
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

fn ids(hits: &Value) -> Vec<Value> {
    hits["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| hit["id"].clone())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn every_command_against_the_api() {
    let Some(cli) = cli().await else { return };
    let shop = "test/shop";

    let made = cli.ok(&[
        "create",
        shop,
        "--vector",
        "embedding:2",
        "--attr",
        "tag:string",
        "--attr",
        "price:number",
        "--attr",
        "labels:strings",
    ]);
    assert!(made.contains("created test/shop"), "{made}");
    let dir = tempfile::tempdir().unwrap();
    let schema = dir.path().join("schema.json");
    let text =
        r#"{"vectors": [{"name": "a", "dims": 2}, {"name": "b", "dims": 3, "metric": "dot"}]}"#;
    std::fs::write(&schema, text).unwrap();
    cli.ok(&["create", "test/two", "--schema", schema.to_str().unwrap()]);

    let list = cli.ok(&["list"]);
    assert!(list.starts_with("NAME"), "{list}");
    assert!(
        list.contains("test/shop") && list.contains("tag:string"),
        "{list}"
    );
    let names: Vec<Value> = cli
        .json(&["list"])
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["name"].clone())
        .collect();
    assert_eq!(names, [json!("test/shop"), json!("test/two")]);

    let lines: String = (0..25)
        .map(|i| {
            let tag = if i % 2 == 0 { "even" } else { "odd" };
            format!(
                "{{\"id\": {i}, \"embedding\": [1, {}], \"tag\": \"{tag}\", \"price\": {i}}}\n",
                i as f64 / 10.0
            )
        })
        .collect();
    let wrote = cli.ok_with(&["upsert", shop, "--batch-size", "10"], Some(&lines));
    assert_eq!(wrote.trim(), "wrote 25 documents to test/shop:main");
    let csv = dir.path().join("more.csv");
    std::fs::write(&csv, "id,embedding,tag,labels\nsku-1,\"[0,1]\",x,a|b\n").unwrap();
    assert_eq!(
        cli.json(&["upsert", shop, csv.to_str().unwrap()]),
        json!({"count": 26 - 25})
    );

    let info = cli.json(&["get", shop]);
    assert_eq!(info["stats"]["rows"], 26);
    let shown = cli.ok(&["get", shop]);
    assert!(shown.contains("embedding  vector[2]  cosine"), "{shown}");

    let hits = cli.json(&[
        "query",
        shop,
        "--vector",
        "[1, 0]",
        "-k",
        "3",
        "-f",
        "tag = odd and price >= 3",
        "-i",
        "tag,price",
    ]);
    assert_eq!(ids(&hits), [json!(3), json!(5), json!(7)]);
    assert_eq!(
        hits["hits"][0]["attributes"],
        json!({"tag": "odd", "price": 3})
    );
    let hits = cli.json(&[
        "query",
        shop,
        "--vector",
        "[0, 1]",
        "-k",
        "1",
        "-f",
        "labels in (b)",
    ]);
    assert_eq!(ids(&hits), [json!("sku-1")]);
    let vector = dir.path().join("vector.json");
    std::fs::write(&vector, "[1, 0]").unwrap();
    let table = cli.ok(&[
        "query",
        shop,
        "--vector-file",
        vector.to_str().unwrap(),
        "-k",
        "2",
        "-i",
        "*",
    ]);
    let header: Vec<&str> = table.lines().next().unwrap().split_whitespace().collect();
    assert_eq!(header, ["ID", "DISTANCE", "tag", "price", "labels"]);
    assert_eq!(
        table.lines().nth(1).unwrap().split_whitespace().next(),
        Some("0")
    );

    assert!(
        cli.ok(&["fork", shop, "agents/try"])
            .contains("forked test/shop:main as agents/try")
    );
    assert_eq!(
        cli.json(&["delete-docs", shop, "0", "sku-1", "-b", "agents/try"]),
        json!({"count": 2})
    );
    let on_fork = cli.json(&[
        "query",
        shop,
        "--vector",
        "[1, 0]",
        "-k",
        "1",
        "-b",
        "agents/try",
    ]);
    assert_eq!(ids(&on_fork), [json!(1)]);
    let on_main = cli.json(&["query", shop, "--vector", "[1, 0]", "-k", "1"]);
    assert_eq!(ids(&on_main), [json!(0)]);
    assert_eq!(
        cli.json(&["stats", shop, "-b", "agents/try"])["stats"]["rows"],
        24
    );
    let branches: Vec<Value> = cli
        .json(&["branches", shop])
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["name"].clone())
        .collect();
    assert_eq!(branches, [json!("agents/try"), json!("main")]);

    assert!(
        cli.ok(&["build", shop])
            .starts_with("building test/shop:main")
    );
    cli.ok(&["delete-branch", shop, "agents/try"]);
    assert_eq!(cli.json(&["branches", shop]).as_array().unwrap().len(), 1);

    let error = cli.fails(
        &["query", shop, "--vector", "[1, 0]", "-f", "price < cheap"],
        None,
    );
    assert!(error.contains("filter.price.lt"), "{error}");
    let error = cli.fails(
        &["query", shop, "--vector", "[1, 0]", "-f", "price 3"],
        None,
    );
    assert!(
        error.contains("expected an operator after `price`"),
        "{error}"
    );
    let error = cli.fails(&["query", "test/two", "--vector", "[1, 0]"], None);
    assert!(error.contains("pick one with --column"), "{error}");
    let error = cli.fails(
        &["upsert", shop],
        Some("{\"id\": 1, \"embedding\": [1, 0], \"colour\": \"red\"}\n"),
    );
    assert!(
        error.contains("row 1: `colour` is not a column of the index"),
        "{error}"
    );
    let error = cli.fails(&["get", "test/none"], None);
    assert!(
        error.contains("index `test/none` does not exist (404)"),
        "{error}"
    );

    let error = cli.fails(&["delete", shop], None);
    assert!(error.contains("Pass --yes"), "{error}");
    cli.ok(&["delete", shop, "--yes"]);
    cli.ok(&["delete", "test/two", "--yes"]);
    assert_eq!(cli.json(&["list"]), json!([]));
}

#[test]
fn a_missing_key_is_explained() {
    let out = Command::new(env!("CARGO_BIN_EXE_skywake"))
        .args(["index", "list"])
        .env_remove("SKYWAKE_KEY")
        .output()
        .unwrap();
    assert!(!out.status.success());
    let error = String::from_utf8_lossy(&out.stderr);
    assert!(error.contains("no API key: set SKYWAKE_KEY"), "{error}");
}
