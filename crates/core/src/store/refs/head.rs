//! A branch head as read: its commit, and the version a later write must match.

use object_store::UpdateVersion;

use super::wire::Stored;
use crate::Commit;

#[derive(Debug, Clone)]
pub struct Head {
    pub seq: u64,
    pub commit: Commit,
    pub(super) version: Version,
    pub(super) token: u64,
}

#[derive(Debug, Clone)]
pub(super) enum Version {
    Bucket(UpdateVersion),
    Served,
}

impl Head {
    pub(crate) fn same_write(&self, other: &Head) -> bool {
        self.token == other.token && self.seq == other.seq
    }

    pub(super) fn in_bucket(stored: Stored, version: UpdateVersion) -> Self {
        Self {
            seq: stored.seq,
            commit: stored.commit,
            version: Version::Bucket(version),
            token: stored.token,
        }
    }

    pub(super) fn served(stored: Stored) -> Self {
        Self {
            seq: stored.seq,
            commit: stored.commit,
            version: Version::Served,
            token: stored.token,
        }
    }

    pub fn stored(&self) -> Stored {
        Stored {
            seq: self.seq,
            token: self.token,
            commit: self.commit.clone(),
        }
    }

    pub fn bucket_version(&self) -> Option<&UpdateVersion> {
        match &self.version {
            Version::Bucket(version) => Some(version),
            Version::Served => None,
        }
    }
}
