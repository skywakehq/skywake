//! Where a result came from: the commit, whether the tree had changes, when it started, and the hardware.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct Environment {
    pub commit: String,
    pub dirty: bool,
    pub started: String,
    pub machine: Machine,
}

#[derive(Serialize)]
pub(crate) struct Machine {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub arch: String,
    pub cpu: String,
    pub cores: usize,
    pub memory_bytes: u64,
}

impl Environment {
    pub(crate) fn capture() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let git = |args: &[&str]| {
            let root = root.to_string_lossy();
            let mut all = vec!["-c", "safe.directory=*", "-C", &root];
            all.extend(args);
            run("git", &all)
        };
        Self {
            commit: git(&["rev-parse", "--short", "HEAD"]),
            dirty: !git(&["status", "--porcelain", "--untracked-files=no"]).is_empty(),
            started: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            machine: Machine {
                hostname: run("hostname", &[]),
                os: std::env::consts::OS.to_string(),
                kernel: run("uname", &["-sr"]),
                arch: std::env::consts::ARCH.to_string(),
                cpu: cpu(),
                cores: std::thread::available_parallelism().map_or(1, |n| n.get()),
                memory_bytes: memory(),
            },
        }
    }

    pub(crate) fn commit_label(&self) -> String {
        match self.dirty {
            true => format!("{}+dirty", self.commit),
            false => self.commit.clone(),
        }
    }
}

fn run(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default()
}

fn proc_field(file: &str, key: &str) -> Option<String> {
    let text = std::fs::read_to_string(file).ok()?;
    let line = text.lines().find(|line| line.starts_with(key))?;
    Some(line.split_once(':')?.1.trim().to_string())
}

fn cpu() -> String {
    let found = match cfg!(target_os = "macos") {
        true => run("sysctl", &["-n", "machdep.cpu.brand_string"]),
        false => proc_field("/proc/cpuinfo", "model name").unwrap_or_default(),
    };
    match found.is_empty() {
        true => std::env::consts::ARCH.to_string(),
        false => found,
    }
}

fn memory() -> u64 {
    match cfg!(target_os = "macos") {
        true => run("sysctl", &["-n", "hw.memsize"]).parse().unwrap_or(0),
        false => proc_field("/proc/meminfo", "MemTotal")
            .and_then(|kb| kb.trim_end_matches("kB").trim().parse::<u64>().ok())
            .map_or(0, |kb| kb * 1024),
    }
}
