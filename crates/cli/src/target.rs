use anyhow::{Result, bail};

pub(crate) const MAIN: &str = "main";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub(crate) name: String,
    pub(crate) branch: Option<String>,
    pub(crate) path: Option<String>,
}

impl Target {
    pub(crate) fn parse(text: &str) -> Result<Target> {
        let (place, path) = match text.split_once('/') {
            Some((place, path)) => (place, Some(path.trim_matches('/').to_string())),
            None => (text, None),
        };
        Target::split(text, place, path)
    }

    pub(crate) fn place(text: &str) -> Result<Target> {
        Target::split(text, text, None)
    }

    fn split(text: &str, place: &str, path: Option<String>) -> Result<Target> {
        let (name, branch) = match place.split_once('@') {
            Some((name, branch)) => (name, Some(branch.to_string())),
            None => (place, None),
        };
        if name.is_empty() {
            bail!("`{text}` names nothing: write NAME, NAME@BRANCH or NAME/PATH");
        }
        if branch.as_deref() == Some("") {
            bail!("`{text}` has an empty branch after `@`");
        }
        let path = path.filter(|path| !path.is_empty());
        Ok(Target {
            name: name.to_string(),
            branch,
            path,
        })
    }

    pub(crate) fn branch(&self) -> &str {
        self.branch.as_deref().unwrap_or(MAIN)
    }

    pub(crate) fn path(&self) -> &str {
        self.path.as_deref().unwrap_or("")
    }

    pub(crate) fn file(&self) -> Result<&str> {
        match self.path.as_deref() {
            Some(path) => Ok(path),
            None => bail!(
                "`{}` needs a file path, such as {}/notes.md",
                self.name,
                self.name
            ),
        }
    }

    pub(crate) fn label(&self) -> String {
        match &self.branch {
            Some(branch) => format!("{}@{branch}", self.name),
            None => self.name.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(name: &str, branch: Option<&str>, path: Option<&str>) -> Target {
        Target {
            name: name.into(),
            branch: branch.map(String::from),
            path: path.map(String::from),
        }
    }

    #[test]
    fn a_name_alone_means_main() {
        let parsed = Target::parse("app").unwrap();
        assert_eq!(parsed, target("app", None, None));
        assert_eq!(parsed.branch(), "main");
    }

    #[test]
    fn a_branch_and_a_path_are_split_off() {
        assert_eq!(
            Target::parse("app@agent-1/docs/notes.md").unwrap(),
            target("app", Some("agent-1"), Some("docs/notes.md"))
        );
        assert_eq!(
            Target::parse("app/docs/").unwrap(),
            target("app", None, Some("docs"))
        );
        assert_eq!(Target::parse("app/").unwrap(), target("app", None, None));
    }

    #[test]
    fn a_place_keeps_slashes_in_its_branch() {
        assert_eq!(
            Target::place("app@feature/login").unwrap(),
            target("app", Some("feature/login"), None)
        );
    }

    #[test]
    fn empty_parts_are_refused() {
        assert!(Target::parse("@main").is_err());
        assert!(Target::parse("app@").is_err());
        assert!(Target::parse("app").unwrap().file().is_err());
    }
}
