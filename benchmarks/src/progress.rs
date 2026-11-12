//! What a long run is doing, written for a person following the log and for an
//! agent reading it. Each event is one line on stderr:
//!
//! ```text
//! 12:04:31  +41:13  load      40%  4,000,000 / 10,000,000 rows · 9,120 rows/s · eta 11m
//! ```
//!
//! and, after `record_to`, the same event as one JSON object per line.

use std::fmt::Write as _;
use std::fs::File;
use std::io::Write as _;
use std::path::Path;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};

const METER_EVERY: Duration = Duration::from_secs(30);
const METER_STEP: f64 = 0.1;

static STARTED: OnceLock<Instant> = OnceLock::new();
static EVENTS: Mutex<Option<File>> = Mutex::new(None);

/// Also writes every event to `path`, as JSON lines.
pub fn record_to(path: &Path) -> std::io::Result<()> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    *EVENTS.lock().unwrap_or_else(PoisonError::into_inner) = Some(File::create(path)?);
    Ok(())
}

/// One thing that happened in `step`.
pub fn note(step: &str, message: &str) {
    event(step, "note", message, Map::new());
}

/// A step that takes a while: says when it starts, and how long it took.
pub struct Step {
    name: String,
    started: Instant,
}

pub fn start(step: &str, message: &str) -> Step {
    event(step, "start", message, Map::new());
    Step {
        name: step.to_string(),
        started: Instant::now(),
    }
}

impl Step {
    pub fn done(self, message: &str) -> Duration {
        let took = self.started.elapsed();
        let mut fields = Map::new();
        fields.insert("seconds".into(), json!(round(took.as_secs_f64())));
        let message = match message {
            "" => format!("done in {}", duration(took)),
            message => format!("done in {} · {message}", duration(took)),
        };
        event(&self.name, "done", &message, fields);
        took
    }
}

/// Counts work toward a known total, and says how far it got every tenth of
/// the way or every half minute, whichever comes first.
pub struct Meter {
    step: String,
    unit: String,
    total: u64,
    done: u64,
    started: Instant,
    told_at: Instant,
    told_share: f64,
}

impl Meter {
    pub fn new(step: &str, total: u64, unit: &str) -> Self {
        Self {
            step: step.to_string(),
            unit: unit.to_string(),
            total,
            done: 0,
            started: Instant::now(),
            told_at: Instant::now(),
            told_share: 0.0,
        }
    }

    pub fn add(&mut self, n: u64) {
        self.done += n;
        let share = self.done as f64 / self.total.max(1) as f64;
        if share - self.told_share >= METER_STEP || self.told_at.elapsed() >= METER_EVERY {
            self.tell(share);
        }
    }

    fn tell(&mut self, share: f64) {
        self.told_at = Instant::now();
        self.told_share = share;
        let seconds = self.started.elapsed().as_secs_f64().max(1e-9);
        let rate = self.done as f64 / seconds;
        let left = self.total.saturating_sub(self.done) as f64 / rate.max(1e-9);
        let mut message = format!(
            "{:>3.0}%  {} / {} {} · {} {}/s",
            share * 100.0,
            count(self.done),
            count(self.total),
            self.unit,
            count(rate as u64),
            self.unit,
        );
        if self.done < self.total {
            let _ = write!(
                message,
                " · eta {}",
                duration(Duration::from_secs_f64(left))
            );
        }
        let mut fields = Map::new();
        fields.insert("done".into(), json!(self.done));
        fields.insert("total".into(), json!(self.total));
        fields.insert("unit".into(), json!(self.unit));
        fields.insert("rate".into(), json!(round(rate)));
        fields.insert("eta_seconds".into(), json!(round(left)));
        event(&self.step, "progress", &message, fields);
    }
}

/// Says `what()` every `period` until dropped, for steps whose total is not known.
pub struct Heartbeat(tokio::task::JoinHandle<()>);

pub fn every(
    step: &str,
    period: Duration,
    what: impl Fn() -> String + Send + 'static,
) -> Heartbeat {
    let step = step.to_string();
    Heartbeat(tokio::spawn(async move {
        let mut tick = tokio::time::interval(period);
        tick.tick().await;
        loop {
            tick.tick().await;
            event(&step, "progress", &what(), Map::new());
        }
    }))
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        self.0.abort();
    }
}

fn event(step: &str, kind: &str, message: &str, mut fields: Map<String, Value>) {
    let elapsed = STARTED.get_or_init(Instant::now).elapsed();
    let now = chrono::Utc::now();
    eprintln!(
        "{}  +{:<7} {step:<9} {message}",
        now.format("%H:%M:%S"),
        clock(elapsed)
    );
    let mut events = EVENTS.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(file) = events.as_mut() {
        fields.insert("time".into(), json!(now.to_rfc3339()));
        fields.insert(
            "elapsed_seconds".into(),
            json!(round(elapsed.as_secs_f64())),
        );
        fields.insert("step".into(), json!(step));
        fields.insert("event".into(), json!(kind));
        fields.insert("message".into(), json!(message));
        let _ = writeln!(file, "{}", Value::Object(fields));
    }
}

/// 1234567 as "1,234,567".
pub fn count(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// Bytes as "12.3 GB".
pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = n as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    match unit {
        0 => format!("{n} B"),
        _ => format!("{value:.1} {}", UNITS[unit]),
    }
}

/// A span as "850 ms", "42 s", "11m 5s" or "1h 12m".
pub fn duration(span: Duration) -> String {
    let seconds = span.as_secs();
    match seconds {
        0 => format!("{} ms", span.as_millis()),
        1..60 => format!("{:.0} s", span.as_secs_f64()),
        60..3600 => format!("{}m {}s", seconds / 60, seconds % 60),
        _ => format!("{}h {}m", seconds / 3600, seconds % 3600 / 60),
    }
}

fn clock(span: Duration) -> String {
    let seconds = span.as_secs();
    match seconds {
        0..3600 => format!("{}:{:02}", seconds / 60, seconds % 60),
        _ => format!(
            "{}:{:02}:{:02}",
            seconds / 3600,
            seconds % 3600 / 60,
            seconds % 60
        ),
    }
}

fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_read_like_a_person_wrote_them() {
        assert_eq!(count(0), "0");
        assert_eq!(count(1234567), "1,234,567");
        assert_eq!(bytes(999), "999 B");
        assert_eq!(bytes(12_345_678_901), "12.3 GB");
        assert_eq!(duration(Duration::from_millis(850)), "850 ms");
        assert_eq!(duration(Duration::from_secs(665)), "11m 5s");
        assert_eq!(duration(Duration::from_secs(4320)), "1h 12m");
        assert_eq!(clock(Duration::from_secs(2473)), "41:13");
    }
}
