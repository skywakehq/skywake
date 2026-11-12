//! The most memory this process has used so far.

pub(crate) fn peak_rss() -> u64 {
    // Linux getrusage carries the parent's peak into a child; VmHWM does not.
    if let Some(peak) = high_water_mark() {
        return peak;
    }
    // SAFETY: `getrusage` fills the struct it is given, which may start as zeros.
    let usage = unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
        usage
    };
    let max = usage.ru_maxrss as u64;
    match cfg!(target_os = "macos") {
        true => max,
        false => max * 1024,
    }
}

fn high_water_mark() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|line| line.starts_with("VmHWM:"))?;
    let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib * 1024)
}
