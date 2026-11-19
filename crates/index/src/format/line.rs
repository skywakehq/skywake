//! Where a branch came from and what it took from other branches, so a merge
//! finds the writes two branches do not share without replaying their history.

use std::ops::Range;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Line {
    pub id: u64,
    pub forks: Vec<Fork>,
    pub imports: Vec<Import>,
}

/// An ancestor line, and its next sequence number when this line left it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Fork {
    pub line: u64,
    pub seq: u64,
}

/// Writes taken from another line: its writes below `upto`, which took the
/// sequence numbers `at` here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Import {
    pub line: u64,
    pub upto: u64,
    pub at: Range<u64>,
}

impl Line {
    pub(crate) fn fork(&self, id: u64, next_seq: u64) -> Line {
        let mut forks = self.forks.clone();
        forks.push(Fork {
            line: self.id,
            seq: next_seq,
        });
        Line {
            id,
            forks,
            imports: Vec::new(),
        }
    }

    /// The writes of `from` this line already has: those below the returned
    /// sequence number, and those it imported from here.
    pub(crate) fn shared(&self, from: &Line) -> (u64, Vec<Range<u64>>) {
        fn ancestor(line: &Line, id: u64) -> Option<Fork> {
            line.forks.iter().find(|fork| fork.line == id).copied()
        }
        let base = match (
            self.id == from.id,
            ancestor(from, self.id),
            ancestor(self, from.id),
        ) {
            (true, ..) => 0,
            (_, Some(fork), _) | (_, _, Some(fork)) => fork.seq,
            _ => (from.forks.iter().rev())
                .find_map(|theirs| ancestor(self, theirs.line).map(|ours| ours.seq.min(theirs.seq)))
                .unwrap_or(0),
        };
        let taken = (self.imports.iter())
            .filter(|import| import.line == from.id)
            .map(|import| import.upto)
            .max()
            .unwrap_or(0);
        let mine = (from.imports.iter())
            .filter(|import| import.line == self.id)
            .map(|import| import.at.clone())
            .collect();
        (base.max(taken), mine)
    }
}
