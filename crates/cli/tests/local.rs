//! Branch commands on a store in a local folder, with no API or daemon.

use std::path::Path;
use std::process::Command;

fn skywake(store: &Path, args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_skywake"))
        .arg("--store")
        .arg(store)
        .args(args)
        .env_remove("SKYWAKE_URL")
        .env_remove("SKYWAKE_KEY")
        .env("SKYWAKE_ROOT", store.join("root"))
        .output()
        .unwrap();
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    (out.status.success(), text)
}

#[test]
fn history_of_a_path_the_branch_never_had_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    let files = dir.path().join("files");
    std::fs::create_dir(&files).unwrap();
    std::fs::write(files.join("a.txt"), "one").unwrap();

    let dir_arg = files.to_str().unwrap();
    assert!(skywake(&store, &["new", "main"]).0);
    assert!(skywake(&store, &["commit", "main", dir_arg, "-m", "first"]).0);

    let (ok, out) = skywake(&store, &["history", "main", "a.txt"]);
    assert!(ok && out.contains("first"), "{out}");
    let (ok, out) = skywake(&store, &["history", "main", "missing.txt"]);
    assert!(!ok && out.contains("missing.txt"), "{out}");
}

#[test]
fn reading_where_there_is_no_store_makes_none() {
    let dir = tempfile::tempdir().unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_skywake"))
        .arg("branches")
        .current_dir(dir.path())
        .env_remove("SKYWAKE_URL")
        .env_remove("SKYWAKE_KEY")
        .env("SKYWAKE_ROOT", dir.path().join("root"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success() && text.contains("no store here"),
        "{text}"
    );
    assert!(!dir.path().join(".skywake").exists());
}

#[test]
fn recover_names_the_folder_it_could_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    let gone = dir.path().join("gone");
    let (ok, out) = skywake(&store, &["recover", gone.to_str().unwrap(), "main"]);
    assert!(!ok && out.contains(gone.to_str().unwrap()), "{out}");
}
