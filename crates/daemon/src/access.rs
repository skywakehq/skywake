//! The access file: which members of skywaked's group may read or write which branches.

use std::ffi::CString;
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, bail};
use tracing::{info, warn};

const MAX_SIZE: u64 = 1 << 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Access {
    Read,
    Write,
}

impl Access {
    fn name(self) -> &'static str {
        match self {
            Access::Read => "read",
            Access::Write => "write",
        }
    }
}

impl std::fmt::Display for Access {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

#[derive(Debug, PartialEq)]
enum Who {
    User(u32),
    Group(u32),
}

#[derive(Debug, PartialEq)]
struct Rule {
    who: Who,
    access: Access,
    pattern: String,
}

#[derive(Debug, Default, PartialEq)]
pub struct Policy {
    rules: Vec<Rule>,
}

pub fn matches(pattern: &str, branch: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    match pattern.strip_suffix('*') {
        Some(prefix) if prefix.ends_with('/') => branch.starts_with(prefix),
        _ => pattern == branch,
    }
}

impl Policy {
    pub fn parse(text: &str) -> Result<Self> {
        Self::parse_with(text, user_id, group_id)
    }

    fn parse_with(
        text: &str,
        user: impl Fn(&str) -> Option<u32>,
        group: impl Fn(&str) -> Option<u32>,
    ) -> Result<Self> {
        let mut rules = Vec::new();
        for (number, line) in text.lines().enumerate() {
            let line = line.split('#').next().unwrap_or_default();
            let words: Vec<&str> = line.split_whitespace().collect();
            if words.is_empty() {
                continue;
            }
            let rule = rule(&words, &user, &group)
                .with_context(|| format!("line {}: {}", number + 1, line.trim()))?;
            rules.push(rule);
        }
        Ok(Self { rules })
    }

    pub fn allows(&self, uid: u32, groups: &[u32], branch: &str, need: Access) -> bool {
        self.rules.iter().any(|rule| {
            let named = match rule.who {
                Who::User(id) => id == uid,
                Who::Group(id) => groups.contains(&id),
            };
            named && rule.access >= need && matches(&rule.pattern, branch)
        })
    }
}

fn rule(
    words: &[&str],
    user: impl Fn(&str) -> Option<u32>,
    group: impl Fn(&str) -> Option<u32>,
) -> Result<Rule> {
    let [who, access, pattern] = words else {
        bail!("expected `user:<name> read|write <branches>`");
    };
    let id =
        |name: &str, find: &dyn Fn(&str) -> Option<u32>| name.parse().ok().or_else(|| find(name));
    let who = match who.split_once(':') {
        Some(("user", name)) => {
            Who::User(id(name, &user).with_context(|| format!("no user {name}"))?)
        }
        Some(("group", name)) => {
            Who::Group(id(name, &group).with_context(|| format!("no group {name}"))?)
        }
        _ => bail!("{who}: expected user:<name> or group:<name>"),
    };
    let access = match *access {
        "read" => Access::Read,
        "write" => Access::Write,
        _ => bail!("{access}: expected read or write"),
    };
    let star = pattern.find('*');
    if star.is_some()
        && *pattern != "*"
        && !(pattern.ends_with("/*") && star == Some(pattern.len() - 1))
    {
        bail!("{pattern}: a pattern is *, a branch, or a prefix like agents/*");
    }
    Ok(Rule {
        who,
        access,
        pattern: pattern.to_string(),
    })
}

type Stamp = [i64; 7];

fn stamp(found: &std::fs::Metadata) -> Stamp {
    [
        found.dev() as i64,
        found.ino() as i64,
        found.len() as i64,
        found.mtime(),
        found.mtime_nsec(),
        found.ctime(),
        found.ctime_nsec(),
    ]
}

pub fn load(path: &Path, admin: u32) -> Result<Option<(Stamp, Policy)>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).with_context(|| format!("{}", path.display())),
    };
    let found = file.metadata()?;
    if !found.is_file() {
        bail!("{} is not a plain file", path.display());
    }
    if found.uid() != 0 && found.uid() != admin {
        bail!(
            "{} belongs to user {}; only root or the user running skywaked may own it",
            path.display(),
            found.uid()
        );
    }
    if found.mode() & 0o022 != 0 {
        bail!(
            "{} can be changed by others; run chmod go-w on it",
            path.display()
        );
    }
    let mut text = String::new();
    (&mut file).take(MAX_SIZE).read_to_string(&mut text)?;
    let policy = Policy::parse(&text).with_context(|| format!("{}", path.display()))?;
    Ok(Some((stamp(&found), policy)))
}

pub struct AccessFile {
    pub path: PathBuf,
    admin: u32,
    state: Mutex<State>,
}

struct State {
    seen: Option<Stamp>,
    policy: Option<Arc<Policy>>,
}

impl AccessFile {
    pub fn open(path: PathBuf, admin: u32) -> Result<Self> {
        let loaded = load(&path, admin)?;
        let (seen, policy) = match loaded {
            Some((seen, policy)) => (Some(seen), Some(Arc::new(policy))),
            None => (None, None),
        };
        Ok(Self {
            path,
            admin,
            state: Mutex::new(State { seen, policy }),
        })
    }

    pub fn policy(&self) -> Option<Arc<Policy>> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = std::fs::metadata(&self.path)
            .ok()
            .map(|found| stamp(&found));
        if now != state.seen {
            state.seen = now;
            match load(&self.path, self.admin) {
                Ok(Some((seen, policy))) => {
                    info!(path = %self.path.display(), "access file read again");
                    state.seen = Some(seen);
                    state.policy = Some(Arc::new(policy));
                }
                Ok(None) => {
                    warn!(path = %self.path.display(), "access file removed: every member may now read and write every branch");
                    state.policy = None;
                }
                Err(error) => warn!("{error:#}; keeping the rules read before"),
            }
        }
        state.policy.clone()
    }
}

fn user_id(name: &str) -> Option<u32> {
    let name = CString::new(name).ok()?;
    let mut buffer = vec![0 as libc::c_char; 16 * 1024];
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut found = std::ptr::null_mut();
    // SAFETY: every pointer is valid for the sizes given, during the call.
    unsafe {
        libc::getpwnam_r(
            name.as_ptr(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        )
    };
    // SAFETY: found, so `entry` is filled in.
    (!found.is_null()).then(|| unsafe { entry.assume_init().pw_uid })
}

fn group_id(name: &str) -> Option<u32> {
    let name = CString::new(name).ok()?;
    let mut buffer = vec![0 as libc::c_char; 64 * 1024];
    let mut entry = std::mem::MaybeUninit::<libc::group>::uninit();
    let mut found = std::ptr::null_mut();
    // SAFETY: every pointer is valid for the sizes given, during the call.
    unsafe {
        libc::getgrnam_r(
            name.as_ptr(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        )
    };
    // SAFETY: found, so `entry` is filled in.
    (!found.is_null()).then(|| unsafe { entry.assume_init().gr_gid })
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn patterns_match_like_api_key_scopes() {
        assert!(matches("*", "anything/at/all"));
        assert!(matches("prod/*", "prod/x"));
        assert!(matches("prod/*", "prod/x/y"));
        assert!(!matches("prod/*", "production"));
        assert!(!matches("prod/*", "prod"));
        assert!(!matches("prod/*", "other/prod/x"));
        assert!(matches("main", "main"));
        assert!(!matches("main", "main/x"));
        assert!(!matches("main", "mainline"));
    }

    fn parse(text: &str) -> Result<Policy> {
        let names = |name: &str| match name {
            "ann" => Some(1000),
            "ci" => Some(50),
            _ => None,
        };
        Policy::parse_with(text, names, names)
    }

    #[test]
    fn members_get_what_their_lines_allow() {
        let policy = parse(
            "# who may do what\n\
             user:ann write agents/*   # ann's agents\n\
             \n\
             group:ci read *\n\
             user:1001 read main\n",
        )
        .unwrap();
        let ann = |branch, need| policy.allows(1000, &[100], branch, need);
        assert!(ann("agents/a", Access::Write));
        assert!(ann("agents/a", Access::Read));
        assert!(!ann("agents", Access::Read));
        assert!(!ann("main", Access::Read));
        assert!(policy.allows(1000, &[100, 50], "main", Access::Read));
        assert!(!policy.allows(1000, &[100, 50], "main", Access::Write));
        assert!(policy.allows(1001, &[], "main", Access::Read));
        assert!(!policy.allows(1001, &[], "main", Access::Write));
        assert!(!policy.allows(1002, &[100], "agents/a", Access::Read));
        assert!(!parse("").unwrap().allows(1000, &[], "main", Access::Read));
    }

    #[test]
    fn mistakes_are_refused_with_their_line() {
        for (text, problem) in [
            ("user:bob write *", "no user bob"),
            ("group:nobody-here read *", "no group"),
            ("ann write *", "expected user:"),
            ("user:ann admin *", "expected read or write"),
            ("user:ann write", "expected `user:"),
            ("user:ann write a b", "expected `user:"),
            ("user:ann write agents*", "a pattern is"),
            ("user:ann write */x", "a pattern is"),
            ("user:ann write a/*/*", "a pattern is"),
        ] {
            let error = format!("{:#}", parse(&format!("\n{text}")).unwrap_err());
            assert!(error.contains(problem), "{text}: {error}");
            assert!(error.contains("line 2"), "{text}: {error}");
        }
    }

    fn me() -> u32 {
        // SAFETY: geteuid can't fail and uses no memory.
        unsafe { libc::geteuid() }
    }

    #[test]
    fn only_a_file_others_cant_change_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("access");
        assert!(load(&path, me()).unwrap().is_none());
        std::fs::write(&path, "user:0 write *\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load(&path, me()).unwrap().is_some());
        for mode in [0o664, 0o646] {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            let error = load(&path, me()).unwrap_err().to_string();
            assert!(error.contains("chmod go-w"), "{error}");
        }
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        if me() != 0 {
            let error = load(&path, me() + 1).unwrap_err().to_string();
            assert!(error.contains("only root"), "{error}");
        }
        assert!(load(dir.path(), me()).is_err(), "read a folder");
    }

    #[test]
    fn changes_to_the_file_apply_and_bad_ones_keep_the_last_rules() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("access");
        let file = AccessFile::open(path.clone(), me()).unwrap();
        assert!(file.policy().is_none());
        let write = |text: &str| {
            let next = dir.path().join("next");
            std::fs::write(&next, text).unwrap();
            std::fs::set_permissions(&next, std::fs::Permissions::from_mode(0o600)).unwrap();
            std::fs::rename(&next, &path).unwrap();
        };
        write("user:7 read *\n");
        let allows = |file: &AccessFile, need| file.policy().unwrap().allows(7, &[], "x", need);
        assert!(allows(&file, Access::Read));
        assert!(!allows(&file, Access::Write));
        write("user:7 write *\n");
        assert!(allows(&file, Access::Write));
        write("user:7 bad *\n");
        assert!(allows(&file, Access::Write), "a bad file dropped the rules");
        std::fs::remove_file(&path).unwrap();
        assert!(file.policy().is_none());

        write("user:7 bad *\n");
        assert!(
            AccessFile::open(path, me()).is_err(),
            "started with a bad file"
        );
    }
}
