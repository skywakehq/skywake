use std::io::{IsTerminal, Write};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use console::{Style, Term, measure_text_width, style};
use dialoguer::theme::ColorfulTheme;
use dialoguer::{Confirm, Select};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::{Value, json};

const SKY: [u8; 7] = [117, 116, 110, 111, 147, 141, 183];
const SPIN: &[&str] = &["◜", "◠", "◝", "◞", "◡", "◟"];

const WORDMARK: [&str; 3] = [
    "┌─┐┬┌─┬ ┬┬ ┬┌─┐┬┌─┌─┐",
    "└─┐├┴┐└┬┘│││├─┤├┴┐├┤ ",
    "└─┘┴ ┴ ┴ └┴┘┴ ┴┴ ┴└─┘",
];

pub(crate) struct Ui {
    pub json: bool,
    pub interactive: bool,
    color: bool,
    err: Term,
}

impl Ui {
    pub(crate) fn new(json: bool) -> Self {
        let err = Term::stderr();
        let color = !json && err.features().colors_supported();
        console::set_colors_enabled_stderr(color);
        console::set_colors_enabled(color);
        Self {
            json,
            interactive: !json && std::io::stdin().is_terminal() && err.is_term(),
            color,
            err,
        }
    }

    fn line(&self, text: impl AsRef<str>) {
        if !self.json {
            let _ = self.err.write_line(text.as_ref());
        }
    }

    pub(crate) fn blank(&self) {
        self.line("");
    }

    pub(crate) fn banner(&self, subtitle: &str) {
        if self.json {
            return;
        }
        self.blank();
        self.line(format!("  {}", dim("✦      ·        ˚      ·    ✦     ·")));
        for row in WORDMARK {
            self.line(format!("  {}", self.gradient(row)));
        }
        let wave = "∿".repeat(WORDMARK[0].chars().count());
        self.line(format!("  {}  {}", self.gradient(&wave), dim(subtitle)));
        self.blank();
    }

    fn gradient(&self, text: &str) -> String {
        if !self.color {
            return text.to_string();
        }
        let width = text.chars().count().max(1);
        text.chars()
            .enumerate()
            .map(|(at, c)| {
                let shade = SKY[at * SKY.len() / width];
                style(c).color256(shade).bold().to_string()
            })
            .collect()
    }

    pub(crate) fn header(&self, name: &str, target: &str, state: &str) {
        self.line(format!(
            "{} {} {} {}",
            accent("◆"),
            style(name).bold(),
            dim(format!("· {target} ·")),
            state
        ));
    }

    pub(crate) fn section(&self, title: &str) {
        self.blank();
        self.line(format!("  {}", style(title).bold()));
    }

    pub(crate) fn rows(&self, rows: &[(&str, String)]) {
        let width = rows.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
        for (key, value) in rows {
            self.line(format!("  {}  {value}", dim(format!("{key:>width$}"))));
        }
    }

    pub(crate) fn note(&self, text: impl AsRef<str>) {
        self.line(format!("  {}", dim(text.as_ref())));
    }

    pub(crate) fn hint(&self, text: impl AsRef<str>) {
        self.line(format!("  {} {}", accent("→"), text.as_ref()));
    }

    pub(crate) fn warn(&self, text: impl AsRef<str>) {
        self.line(format!(
            "  {} {}",
            style("!").yellow().bold(),
            text.as_ref()
        ));
    }

    pub(crate) fn card(&self, title: &str, lines: &[String]) {
        if self.json {
            return;
        }
        let width = (lines.iter().map(|l| measure_text_width(l)))
            .chain([measure_text_width(title) + 2])
            .max()
            .unwrap_or(0);
        let edge = |left: &str, right: &str, fill: String| {
            format!("  {}", accent(format!("{left}{fill}{right}")))
        };
        let top_fill = format!(
            " {title} {}",
            "─".repeat(width.saturating_sub(measure_text_width(title) + 1))
        );
        self.line(edge("╭─", "─╮", top_fill));
        for line in lines {
            let pad = " ".repeat(width - measure_text_width(line));
            self.line(format!("  {}  {line}{pad}  {}", accent("│"), accent("│")));
        }
        self.line(edge("╰─", "─╯", "─".repeat(width + 2)));
    }

    pub(crate) fn event(&self, value: Value) {
        if self.json {
            let mut out = std::io::stdout().lock();
            let _ = writeln!(out, "{value}");
        }
    }

    pub(crate) fn step(&self, id: &str, label: &str) -> Step {
        self.event(json!({ "step": id, "status": "started", "label": label }));
        let bar = (!self.json).then(|| {
            let bar = ProgressBar::with_draw_target(None, indicatif::ProgressDrawTarget::stderr());
            bar.set_style(
                ProgressStyle::with_template("  {spinner:.cyan} {msg} {elapsed:.dim}")
                    .expect("a valid template")
                    .tick_strings(SPIN),
            );
            bar.set_message(label.to_string());
            if self.interactive {
                bar.enable_steady_tick(Duration::from_millis(90));
            }
            bar
        });
        Step {
            id: id.to_string(),
            label: label.to_string(),
            json: self.json,
            started: Instant::now(),
            bar,
        }
    }

    pub(crate) fn choose<T: Copy>(
        &self,
        prompt: &str,
        items: &[(T, String)],
        default: usize,
    ) -> Result<T> {
        if !self.interactive {
            bail!("`{prompt}` needs an answer: pass it as a flag");
        }
        let labels: Vec<&str> = items.iter().map(|(_, label)| label.as_str()).collect();
        let picked = Select::with_theme(&theme())
            .with_prompt(prompt)
            .items(&labels)
            .default(default)
            .interact_on(&self.err)?;
        Ok(items[picked].0)
    }

    pub(crate) fn confirm(&self, prompt: &str, yes: bool) -> Result<bool> {
        if yes {
            return Ok(true);
        }
        if !self.interactive {
            bail!("this changes things: pass --yes to go ahead without a prompt");
        }
        Ok(Confirm::with_theme(&theme())
            .with_prompt(prompt)
            .default(true)
            .interact_on(&self.err)?)
    }
}

pub(crate) struct Step {
    id: String,
    label: String,
    json: bool,
    started: Instant,
    bar: Option<ProgressBar>,
}

impl Step {
    pub(crate) fn message(&self, text: &str) {
        if let Some(bar) = &self.bar {
            bar.set_message(format!("{} {}", self.label, dim(text)));
        }
    }

    pub(crate) fn done(self, detail: impl AsRef<str>) {
        self.finish(true, detail.as_ref());
    }

    pub(crate) fn fail(self, detail: impl AsRef<str>) {
        self.finish(false, detail.as_ref());
    }

    fn finish(self, ok: bool, detail: &str) {
        let seconds = self.started.elapsed().as_secs_f64();
        if self.json {
            let status = if ok { "done" } else { "failed" };
            let event = json!({ "step": self.id, "status": status, "detail": detail, "seconds": (seconds * 10.0).round() / 10.0 });
            println!("{event}");
            return;
        }
        let mark = match ok {
            true => style("✔").green().bold(),
            false => style("✘").red().bold(),
        };
        let time = dim(format!("{seconds:.1}s"));
        let detail = match detail.is_empty() {
            true => String::new(),
            false => format!("  {}", dim(detail)),
        };
        let text = format!("  {mark} {}{detail}  {time}", self.label);
        if let Some(bar) = self.bar {
            bar.finish_and_clear();
        }
        let _ = Term::stderr().write_line(&text);
    }
}

fn theme() -> ColorfulTheme {
    ColorfulTheme {
        prompt_prefix: style("?".to_string()).color256(117).bold(),
        active_item_prefix: style("❯".to_string()).color256(117).bold(),
        active_item_style: Style::new().color256(117),
        success_prefix: style("✔".to_string()).green().bold(),
        ..ColorfulTheme::default()
    }
}

pub(crate) fn dim(text: impl std::fmt::Display) -> String {
    style(text).dim().to_string()
}

pub(crate) fn accent(text: impl std::fmt::Display) -> String {
    style(text).color256(117).to_string()
}

pub(crate) fn good(text: impl std::fmt::Display) -> String {
    style(text).green().to_string()
}

pub(crate) fn bad(text: impl std::fmt::Display) -> String {
    style(text).red().to_string()
}

pub(crate) fn caution(text: impl std::fmt::Display) -> String {
    style(text).yellow().to_string()
}

pub(crate) fn strong(text: impl std::fmt::Display) -> String {
    style(text).bold().to_string()
}
