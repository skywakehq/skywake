//! What an owner answers: a head, a change made on the log, or the heads of a folder.

use skywake_core::heads::{Answer, Ask, Stored, slot};
use skywake_core::valid_name;

use super::{Change, Name, Owned, Refused};
use crate::heads::Heads;

impl Owned {
    pub(in crate::heads) async fn answer(
        &self,
        heads: &Heads,
        name: Name,
        ask: Ask,
    ) -> Result<Answer, Refused> {
        let mut state = self.state.lock().await;
        if matches!(ask, Ask::List) {
            return Err(Refused::Failed);
        }
        if !valid_name(&name.branch) || slot(&name.folder, &name.branch) != self.slot {
            return Ok(Answer::Conflict);
        }
        let root = heads.objects.store();
        let current = state
            .load(&heads.listings, self.sealed, root, &name)
            .await?
            .head
            .clone();
        let change = |head: Option<Stored>, keep_commit, objects| Change {
            name: name.clone(),
            head,
            keep_commit,
            objects,
        };
        let (change, answer) = match ask {
            Ask::Head { .. } => return Ok(Answer::Head(current)),
            Ask::List => unreachable!("refused above"),
            Ask::Create {
                token,
                commit,
                keep_commit,
                ..
            } => {
                match current {
                    Some(head) if head.token == token && head.seq == 0 => {
                        return Ok(Answer::Done(head));
                    }
                    Some(_) => return Ok(Answer::Exists),
                    None => {}
                }
                let head = Stored {
                    seq: 0,
                    token,
                    commit,
                };
                (
                    change(Some(head.clone()), keep_commit, Vec::new()),
                    Answer::Done(head),
                )
            }
            Ask::Advance {
                from_seq,
                from_token,
                token,
                commit,
                objects,
                since,
                ..
            } => {
                match current {
                    Some(head) if head.seq == from_seq && head.token == from_token => {}
                    Some(head) if head.seq == from_seq + 1 && head.token == token => {
                        return Ok(Answer::Done(head));
                    }
                    _ => return Ok(Answer::Conflict),
                }
                if since.is_some_and(|since| !heads.cleanup.clear(since)) {
                    return Ok(Answer::Settle);
                }
                let head = Stored {
                    seq: from_seq + 1,
                    token,
                    commit,
                };
                (
                    change(Some(head.clone()), false, objects),
                    Answer::Done(head),
                )
            }
            Ask::Delete {
                from_seq,
                from_token,
                ..
            } => {
                match current {
                    Some(head) if head.seq == from_seq && head.token == from_token => {}
                    None => return Ok(Answer::Deleted),
                    Some(_) => return Ok(Answer::Conflict),
                }
                (change(None, false, Vec::new()), Answer::Deleted)
            }
        };
        let n = self
            .append(&mut state, &heads.log, std::slice::from_ref(&change))
            .await?;
        let entry = state.heads.entry(name).or_default();
        entry.apply(&change);
        entry.dirty = Some(n);
        Ok(answer)
    }

    pub(in crate::heads) async fn list(
        &self,
        heads: &Heads,
        folder: &str,
        branches: &[String],
    ) -> Result<(Vec<(String, Stored)>, bool), Refused> {
        let root = heads.objects.store();
        let mut state = self.state.lock().await;
        for branch in branches
            .iter()
            .filter(|branch| slot(folder, branch) == self.slot)
        {
            let name = Name {
                folder: folder.to_string(),
                branch: branch.clone(),
            };
            state
                .load(&heads.listings, self.sealed, root, &name)
                .await?;
        }
        let mut live = Vec::new();
        let mut pending = false;
        for (name, entry) in &state.heads {
            if name.folder != folder {
                continue;
            }
            pending |= entry.keep_commit || !entry.objects.is_empty();
            if let Some(head) = &entry.head {
                live.push((name.branch.clone(), head.clone()));
            }
        }
        Ok((live, pending))
    }
}
