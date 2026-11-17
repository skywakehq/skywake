use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::{Error, ErrorKind, Mode, Prefer, Role, Skywake};

struct Keys {
    staging: String,
    read: String,
}

static KEYS: Mutex<Option<Keys>> = Mutex::new(None);

fn asked() -> Option<(String, String)> {
    let url = std::env::var("SKYWAKE_SCENARIO_URL").ok()?;
    let admin = std::env::var("SKYWAKE_SCENARIO_KEY").ok()?;
    Some((url, admin))
}

async fn setup() -> Option<Skywake> {
    let (url, admin) = asked()?;
    if KEYS.lock().unwrap().is_none() {
        let org = Skywake::builder().url(&url).key(&admin).build().unwrap();
        for name in ["prod", "staging"] {
            match org.create_environment(name).await {
                Err(error) if error.kind() == Some(&ErrorKind::Conflict) => {}
                done => {
                    done.unwrap();
                }
            }
        }
        let made = async |name: &str, role: Role, environment: &str| {
            let created = org.create_key(name, role).environment(environment).await;
            created.unwrap().key
        };
        let prod = made("prod", Role::Admin, "prod").await;
        let staging = made("staging", Role::Admin, "staging").await;
        let read = made("reader", Role::Read, "prod").await;
        unsafe {
            for name in ["SKYWAKE_KEY", "SKYWAKE_ENV", "SKYWAKE_PROFILE"] {
                std::env::remove_var(name);
            }
            std::env::set_var("SKYWAKE_URL", &url);
            std::env::set_var("SKYWAKE_API_KEY", &prod);
        }
        *KEYS.lock().unwrap() = Some(Keys { staging, read });
    }
    Some(Skywake::new().unwrap())
}

fn key(pick: fn(&Keys) -> &String) -> String {
    pick(KEYS.lock().unwrap().as_ref().unwrap()).clone()
}

fn kind(result: Result<impl std::fmt::Debug, Error>) -> ErrorKind {
    result.unwrap_err().kind().cloned().unwrap()
}

fn hint(result: Result<impl std::fmt::Debug, Error>) -> (ErrorKind, String) {
    let error = result.unwrap_err();
    let api = error.api().unwrap();
    (api.kind.clone(), api.hint.clone().unwrap_or_default())
}

fn number(row: &serde_json::Map<String, Value>, field: &str) -> f64 {
    row[field].as_f64().unwrap()
}

#[tokio::test]
async fn scenario_01_with_only_the_api_key_set_whoami_shows_the_environment() {
    let Some(sky) = setup().await else { return };
    let me = sky.whoami().await.unwrap();
    assert_eq!(me.environment.as_deref(), Some("prod"));
    assert_eq!(me.role, Role::Admin);
}

#[tokio::test]
async fn scenario_02_one_row_upserted_to_a_new_index_is_found_by_query() {
    let Some(sky) = setup().await else { return };
    let products = sky.index("products");
    let row = json!({ "id": "mug", "text": "a blue coffee mug", "price": 12, "tags": ["kitchen"] });
    products.upsert(row).await.unwrap();
    let hits = products.query("coffee mug").await.unwrap();
    assert_eq!(hits[0]["id"], "mug");
    assert_eq!(number(&hits[0], "price"), 12.0);
    assert!(number(&hits[0], "score") > 0.0);
}

#[tokio::test]
async fn scenario_03_ten_thousand_rows_upserted_in_one_call_are_all_counted() {
    let Some(sky) = setup().await else { return };
    let rows: Vec<Value> = (0..10_000)
        .map(|i| {
            let shoe = i % 2 == 1;
            json!({
                "id": format!("row-{i}"),
                "text": if shoe { format!("running shoe number {i}") } else { format!("invoice {i}") },
                "price": i % 100,
                "tags": [if shoe { "shoes" } else { "billing" }],
            })
        })
        .collect();
    let bulk = sky.index("bulk");
    assert_eq!(bulk.upsert(rows).await.unwrap().count, 10_000);
    assert_eq!(bulk.count().await.unwrap(), 10_000);
    let shoes = json!({ "tags": { "contains": "shoes" } });
    assert_eq!(bulk.count().filter(shoes).await.unwrap(), 5_000);
}

#[tokio::test]
async fn scenario_04_a_query_takes_a_filter_a_limit_and_keywords_mode() {
    let Some(sky) = setup().await else { return };
    let hits = sky
        .index("bulk")
        .query("shoe")
        .mode(Mode::Keywords)
        .filter(json!({ "price": { "lt": 10 } }))
        .limit(3)
        .await
        .unwrap();
    assert_eq!(hits.len(), 3);
    for hit in &hits {
        assert!(number(hit, "price") < 10.0);
        assert!(hit["text"].as_str().unwrap().contains("shoe"));
    }
}

#[tokio::test]
async fn scenario_05_update_shows_in_get_and_delete_makes_get_none() {
    let Some(sky) = setup().await else { return };
    let products = sky.index("products");
    assert_eq!(
        products.update("mug", json!({ "price": 9 })).await.unwrap(),
        1
    );
    assert_eq!(
        number(&products.get("mug").await.unwrap().unwrap(), "price"),
        9.0
    );
    assert_eq!(products.delete("mug").await.unwrap(), 1);
    assert_eq!(products.get("mug").await.unwrap(), None);
}

#[tokio::test]
async fn scenario_06_a_fork_changes_apart_from_main_and_merging_brings_the_change() {
    let Some(sky) = setup().await else { return };
    let products = sky.index("products");
    let cup = json!({ "id": "cup", "text": "a white coffee cup", "price": 5 });
    products.upsert(cup).await.unwrap();
    let draft = products.fork("draft").await.unwrap();
    draft.update("cup", json!({ "price": 7 })).await.unwrap();
    assert_eq!(
        number(&draft.query("coffee cup").await.unwrap()[0], "price"),
        7.0
    );
    assert_eq!(
        number(&products.query("coffee cup").await.unwrap()[0], "price"),
        5.0
    );
    draft.merge_into("main").await.unwrap();
    assert_eq!(
        number(&products.get("cup").await.unwrap().unwrap(), "price"),
        7.0
    );
}

#[tokio::test]
async fn scenario_07_a_file_written_to_a_new_disk_reads_back_and_is_listed() {
    let Some(sky) = setup().await else { return };
    let app = sky.disk("app");
    app.write("README.md", "# App\n").await.unwrap();
    assert_eq!(app.read("README.md").await.unwrap(), "# App\n");
    let listed = app.list("").await.unwrap();
    let listed: Vec<_> = listed
        .iter()
        .map(|entry| (entry.path.as_str(), entry.kind))
        .collect();
    assert_eq!(listed, [("README.md", skywake::Kind::File)]);
}

#[tokio::test]
async fn scenario_08_many_files_written_together_are_one_commit() {
    let Some(sky) = setup().await else { return };
    let app = sky.disk("app");
    let before = app.log().await.unwrap().len();
    app.write_files([
        ("src/a.ts", "export const a = 1;\n"),
        ("src/b.ts", "export const b = 2;\n"),
        ("notes.txt", "hi"),
    ])
    .message("three files")
    .await
    .unwrap();
    let log = app.log().await.unwrap();
    assert_eq!(log.len(), before + 1);
    assert_eq!(log[0].message, "three files");
}

#[tokio::test]
async fn scenario_09_both_sides_changing_one_file_make_the_merge_a_merge_conflict() {
    let Some(sky) = setup().await else { return };
    let app = sky.disk("app");
    let work = app.fork("agent-1").await.unwrap();
    work.write("notes.txt", "from the agent").await.unwrap();
    app.write("notes.txt", "from main").await.unwrap();
    let conflicts = vec!["notes.txt".to_string()];
    assert_eq!(
        kind(work.merge_into("main").await),
        ErrorKind::MergeConflict { conflicts }
    );
    let settled = work
        .merge_into("main")
        .prefer(Prefer::Theirs)
        .await
        .unwrap();
    assert!(settled.commit.is_some());
    assert_eq!(app.read("notes.txt").await.unwrap(), "from the agent");
}

#[tokio::test]
async fn scenario_10_grep_find_and_query_on_a_disk_find_a_file() {
    let Some(sky) = setup().await else { return };
    let app = sky.disk("app");
    app.write("docs/coffee.md", "How to brew coffee at home.\n")
        .await
        .unwrap();
    let lines = app.grep("brew").await.unwrap();
    let lines: Vec<_> = lines
        .iter()
        .map(|line| (line.path.as_str(), line.line))
        .collect();
    assert_eq!(lines, [("docs/coffee.md", 1)]);
    let found = app.find("*.md").path("docs").await.unwrap();
    let found: Vec<_> = found.iter().map(|entry| entry.path.as_str()).collect();
    assert_eq!(found, ["docs/coffee.md"]);
    let mut hits = Vec::new();
    for _ in 0..100 {
        hits = app.query("coffee").await.unwrap();
        if hits.iter().any(|hit| hit.path == "docs/coffee.md") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(hits[0].path, "docs/coffee.md");
}

#[tokio::test]
async fn scenario_11_read_with_at_returns_the_old_content_after_a_change() {
    let Some(sky) = setup().await else { return };
    let app = sky.disk("app");
    let old = app.head().await.unwrap().unwrap();
    app.write("README.md", "# App, changed\n").await.unwrap();
    assert_eq!(app.read("README.md").at(old).await.unwrap(), "# App\n");
    assert_eq!(app.read("README.md").await.unwrap(), "# App, changed\n");
}

#[tokio::test]
async fn scenario_12_keys_stay_in_their_environment_and_their_role() {
    let Some(_) = setup().await else { return };
    let staging = Skywake::builder()
        .key(key(|keys| &keys.staging))
        .environment("prod")
        .build()
        .unwrap();
    let products = staging.index("products");
    assert_eq!(kind(products.query("coffee").await), ErrorKind::Permission);
    let reader = Skywake::builder()
        .key(key(|keys| &keys.read))
        .build()
        .unwrap();
    let products = reader.index("products");
    assert_eq!(
        number(&products.get("cup").await.unwrap().unwrap(), "price"),
        7.0
    );
    let nope = json!({ "id": "x", "text": "nope" });
    assert_eq!(kind(products.upsert(nope).await), ErrorKind::Permission);
}

#[tokio::test]
async fn scenario_13_a_wrong_name_is_not_found_with_a_suggestion() {
    let Some(sky) = setup().await else { return };
    let (found, said) = hint(sky.index("prodcts").query("coffee").await);
    assert_eq!(found, ErrorKind::NotFound);
    assert!(said.contains("products"));
    let (found, said) = hint(sky.disk("ap").read("README.md").await);
    assert_eq!(found, ErrorKind::NotFound);
    assert!(said.contains("`app`"));
}

#[tokio::test]
async fn scenario_14_destroying_a_branch_then_the_index_and_the_disk_empties_the_lists() {
    let Some(sky) = setup().await else { return };
    let products = sky.index("products");
    products.on("draft").destroy().await.unwrap();
    let branches = products.branches().await.unwrap();
    let branches: Vec<_> = branches.iter().map(|branch| branch.name.as_str()).collect();
    assert_eq!(branches, ["main"]);
    let app = sky.disk("app");
    app.on("agent-1").destroy().await.unwrap();
    for name in ["products", "bulk"] {
        sky.index(name).destroy().await.unwrap();
    }
    app.destroy().await.unwrap();
    let indexes: Vec<_> = sky.list_indexes().try_collect().await.unwrap();
    assert!(indexes.is_empty());
    let disks: Vec<_> = sky.list_disks().try_collect().await.unwrap();
    assert!(disks.is_empty());
}

fn scratch(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("skywake-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn scenario_15_a_folder_goes_up_as_one_commit_and_comes_back_the_same() {
    let Some(sky) = setup().await else { return };
    let dir = scratch("up");
    std::fs::write(dir.join("a.txt"), "alpha").unwrap();
    std::fs::write(dir.join("b.bin"), [0, 1, 2, 255]).unwrap();
    let site = sky.disk("site");
    site.upload(&dir).message("site").await.unwrap();
    let back = scratch("down");
    site.download(&back).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(back.join("a.txt")).unwrap(),
        "alpha"
    );
    assert_eq!(std::fs::read(back.join("b.bin")).unwrap(), [0, 1, 2, 255]);
    site.destroy().await.unwrap();
}
