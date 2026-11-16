use std::path::Path;
use std::process::Command;

fn skywake(dir: &Path, local: Option<&Path>, args: &[&str]) -> (bool, String) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_skywake"));
    match local {
        Some(store) => command.arg(format!("--local={}", store.display())),
        None => command.arg("--local"),
    };
    let out = command
        .args(args)
        .current_dir(dir)
        .env_remove("SKYWAKE_URL")
        .env_remove("SKYWAKE_API_KEY")
        .env_remove("SKYWAKE_STORE")
        .env("SKYWAKE_ROOT", dir.join("root"))
        .output()
        .unwrap();
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    (out.status.success(), text)
}

fn files(dir: &Path, name: &str, contents: &[(&str, &str)]) -> String {
    let folder = dir.join(name);
    std::fs::create_dir_all(&folder).unwrap();
    for (path, text) in contents {
        std::fs::write(folder.join(path), text).unwrap();
    }
    folder.to_str().unwrap().to_string()
}

#[test]
fn a_store_is_one_disk_with_branches() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    let local = Some(store.as_path());
    let first = files(dir.path(), "first", &[("a.txt", "one")]);
    let second = files(dir.path(), "second", &[("a.txt", "two"), ("b.txt", "new")]);

    let (ok, out) = skywake(dir.path(), local, &["upload", &first, "app", "-m", "first"]);
    assert!(ok, "{out}");
    let (ok, out) = skywake(dir.path(), local, &["fork", "app", "agent-1"]);
    assert!(ok && out.contains("agent-1"), "{out}");
    let (ok, out) = skywake(
        dir.path(),
        local,
        &["upload", &second, "app@agent-1", "-m", "second"],
    );
    assert!(ok, "{out}");

    let (ok, out) = skywake(dir.path(), local, &["branches", "app"]);
    assert!(
        ok && out.contains("main") && out.contains("agent-1"),
        "{out}"
    );
    let (ok, out) = skywake(dir.path(), local, &["diff", "app@agent-1", "main"]);
    assert!(
        ok && out.contains("~ a.txt") && out.contains("+ b.txt"),
        "{out}"
    );
    let (ok, out) = skywake(dir.path(), local, &["log", "app@agent-1"]);
    assert!(
        ok && out.contains("second") && out.contains("first"),
        "{out}"
    );

    let (ok, out) = skywake(dir.path(), local, &["merge", "app@agent-1"]);
    assert!(ok && out.contains("main"), "{out}");
    let copy = dir.path().join("copy");
    let (ok, out) = skywake(
        dir.path(),
        local,
        &["download", "app", copy.to_str().unwrap()],
    );
    assert!(ok, "{out}");
    assert_eq!(std::fs::read_to_string(copy.join("b.txt")).unwrap(), "new");

    let (ok, out) = skywake(dir.path(), local, &["destroy", "app@agent-1", "--yes"]);
    assert!(ok, "{out}");
    let (_, out) = skywake(dir.path(), local, &["branches", "app"]);
    assert!(!out.contains("agent-1"), "{out}");
}

#[test]
fn log_with_a_path_shows_that_file_only() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    let local = Some(store.as_path());
    let folder = files(dir.path(), "files", &[("a.txt", "one")]);
    assert!(
        skywake(
            dir.path(),
            local,
            &["upload", &folder, "app", "-m", "first"]
        )
        .0
    );

    let (ok, out) = skywake(dir.path(), local, &["log", "app", "--path", "a.txt"]);
    assert!(ok && out.contains("first"), "{out}");
    let (ok, out) = skywake(dir.path(), local, &["log", "app", "--path", "missing.txt"]);
    assert!(!ok && out.contains("missing.txt"), "{out}");
}

#[test]
fn reading_where_there_is_no_store_makes_none() {
    let dir = tempfile::tempdir().unwrap();
    let (ok, out) = skywake(dir.path(), None, &["branches", "app"]);
    assert!(!ok && out.contains("no store here"), "{out}");
    assert!(!dir.path().join(".skywake").exists());
}

#[test]
fn api_only_commands_say_so() {
    let dir = tempfile::tempdir().unwrap();
    let (ok, out) = skywake(dir.path(), None, &["read", "app/notes.md"]);
    assert!(!ok && out.contains("drop --local"), "{out}");
}

#[test]
fn recover_names_the_folder_it_could_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("store");
    let gone = dir.path().join("gone");
    let (ok, out) = skywake(
        dir.path(),
        Some(&store),
        &["recover", gone.to_str().unwrap(), "main"],
    );
    assert!(!ok && out.contains(gone.to_str().unwrap()), "{out}");
}
