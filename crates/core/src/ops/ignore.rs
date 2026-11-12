//! Paths left out of commits, such as build output and caches.

use std::io;
use std::path::Path;

pub const IGNORE_FILE: &str = ".skywakeignore";

const BUILD: &[&str] = &["/target", "/node_modules", "/.venv"];

pub const CACHES: &[&str] = &[
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".DS_Store",
];

pub fn ignored(root: &Path) -> io::Result<Vec<String>> {
    match std::fs::read_to_string(root.join(IGNORE_FILE)) {
        Ok(text) => Ok(parse_ignored(Some(&text))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(parse_ignored(None)),
        Err(error) => Err(error),
    }
}

pub fn parse_ignored(text: Option<&str>) -> Vec<String> {
    let Some(text) = text else {
        return BUILD
            .iter()
            .chain(CACHES)
            .map(|rule| rule.to_string())
            .collect();
    };
    text.lines()
        .map(|line| line.trim().trim_end_matches('/'))
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect()
}

pub fn is_ignored(rules: &[String], path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    rules.iter().any(|rule| match rule.contains('/') {
        true => rule.trim_start_matches('/') == path,
        false => rule == name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_match_in_any_folder() {
        let rules = parse_ignored(None);
        assert!(is_ignored(&rules, "target"));
        assert!(is_ignored(&rules, "src/pkg/__pycache__"));
        assert!(is_ignored(&rules, ".pytest_cache"));
        assert!(!is_ignored(&rules, "src/target"));
        assert!(!is_ignored(&rules, "src/target.rs"));
        assert!(!is_ignored(&rules, ".git"));
    }

    #[test]
    fn paths_match_from_the_root() {
        let rules = parse_ignored(Some("# comment\n/out/\ndocs/build\n"));
        assert!(is_ignored(&rules, "out"));
        assert!(!is_ignored(&rules, "sub/out"));
        assert!(is_ignored(&rules, "docs/build"));
        assert!(!is_ignored(&rules, "other/docs/build"));
        assert!(!is_ignored(&rules, "target"));
    }
}
