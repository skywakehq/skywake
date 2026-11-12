//! A synthetic attribute on every row, and filters on it that pass a known share of the rows.

use anyhow::{Result, ensure};
use skywake_index::Filter;

use super::random::{GOLDEN, mix};

pub(crate) const TAG: &str = "tag";

const TAGS: u64 = 1000;

pub(crate) fn tag(id: u64) -> u32 {
    (mix(id.wrapping_add(GOLDEN)) % TAGS) as u32
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Selection {
    pub below: Option<u32>,
}

impl Selection {
    pub(crate) const ALL: Self = Self { below: None };

    pub(crate) fn percent(text: &str) -> Result<Self> {
        let percent: f64 = text.trim_end_matches('%').parse()?;
        let below = (percent * TAGS as f64 / 100.0).round();
        ensure!(
            (1.0..=TAGS as f64).contains(&below),
            "a filter must pass 0.1% to 100% of rows, not {text}"
        );
        Ok(Self {
            below: Some(below as u32),
        })
    }

    pub(crate) fn passes(self, id: u64) -> bool {
        self.below.is_none_or(|below| tag(id) < below)
    }

    pub(crate) fn filter(self) -> Option<Filter> {
        self.below.map(|below| Filter::lt(TAG, below as f64))
    }

    pub(crate) fn name(self) -> String {
        match self.below {
            None => "all".to_string(),
            Some(below) => format!("{}%", below as f64 * 100.0 / TAGS as f64),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_are_close_to_their_names() {
        for (text, share) in [("50", 0.5), ("10", 0.1), ("1", 0.01), ("0.1", 0.001)] {
            let selection = Selection::percent(text).unwrap();
            let passed = (0..1_000_000).filter(|&id| selection.passes(id)).count();
            let seen = passed as f64 / 1e6;
            assert!((seen - share).abs() < share * 0.1, "{text}: {seen}");
        }
        assert_eq!(Selection::percent("0.1").unwrap().name(), "0.1%");
        assert!(Selection::percent("0.01").is_err());
    }
}
