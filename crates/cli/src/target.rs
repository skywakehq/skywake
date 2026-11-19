use anyhow::{Result, bail};

pub(crate) const MAIN: &str = "main";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub(crate) name: String,
    pub(crate) branch: Option<String>,
}

impl Target {
    pub(crate) fn parse(text: &str) -> Result<Target> {
        let (name, branch) = match text.split_once('@') {
            Some((name, branch)) => (name, Some(branch.to_string())),
            None => (text, None),
        };
        if name.is_empty() {
            bail!("`{text}` names nothing: write INDEX or INDEX@BRANCH");
        }
        if branch.as_deref() == Some("") {
            bail!("`{text}` has an empty branch after `@`");
        }
        Ok(Target {
            name: name.to_string(),
            branch,
        })
    }

    pub(crate) fn branch(&self) -> &str {
        self.branch.as_deref().unwrap_or(MAIN)
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

    fn target(name: &str, branch: Option<&str>) -> Target {
        Target {
            name: name.into(),
            branch: branch.map(String::from),
        }
    }

    #[test]
    fn a_name_alone_means_main() {
        let parsed = Target::parse("products").unwrap();
        assert_eq!(parsed, target("products", None));
        assert_eq!(parsed.branch(), "main");
    }

    #[test]
    fn a_branch_keeps_its_slashes() {
        assert_eq!(
            Target::parse("products@feature/login").unwrap(),
            target("products", Some("feature/login"))
        );
    }

    #[test]
    fn empty_parts_are_refused() {
        assert!(Target::parse("@main").is_err());
        assert!(Target::parse("products@").is_err());
    }
}
