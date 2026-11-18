mod detect;
mod doctor;
mod local;
mod plan;
mod price;
mod settings;
mod ui;

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use clap::{Args, Subcommand};
use serde_json::{Value, json};

use crate::cli::Global;
use detect::Found;
use plan::Plan;
use settings::{Database, FILE, Settings, Size, Target, folder};
use ui::{Ui, accent, dim, good, left, right, strong};

#[derive(Args)]
#[command(args_conflicts_with_subcommands = true)]
pub(crate) struct Deploy {
    #[command(subcommand)]
    action: Option<Action>,
    #[command(flatten)]
    choice: Choice,
}

#[derive(Args, Clone, Default)]
pub(crate) struct Where {
    #[arg(
        long,
        help = "The deployment's name (default: the only one, or `local`)."
    )]
    name: Option<String>,
    #[arg(
        long,
        value_name = "FILE",
        help = "Read and write the settings here instead (default ./skywake.deploy.toml if present)."
    )]
    config: Option<PathBuf>,
}

#[derive(Args, Clone, Default)]
pub(crate) struct Choice {
    #[command(flatten)]
    place: Where,
    #[arg(long, value_enum, help = "Where it runs.")]
    target: Option<Target>,
    #[arg(long, value_enum, help = "How big: tiny, small, medium or large.")]
    size: Option<Size>,
    #[arg(long, help = "The cloud region, such as us-east-1.")]
    region: Option<String>,
    #[arg(long, help = "A domain for HTTPS, such as search.example.com.")]
    domain: Option<String>,
    #[arg(
        long,
        value_name = "GB",
        help = "How much data you expect, for the cost estimate (default 50)."
    )]
    data: Option<u32>,
    #[arg(long, help = "Use this existing bucket instead of making one.")]
    bucket: Option<String>,
    #[arg(
        long,
        value_enum,
        help = "bundled (default), managed by the cloud, or external from SKYWAKE_DATABASE_URL."
    )]
    database: Option<Database>,
    #[arg(long, help = "For the docker target: the server, as user@host.")]
    host: Option<String>,
    #[arg(long, help = "The image registry (default ghcr.io/skywakehq).")]
    registry: Option<String>,
    #[arg(
        long = "image-version",
        value_name = "VERSION",
        help = "The release to run (default: this CLI's own version)."
    )]
    version: Option<String>,
    #[arg(long, short = 'y', help = "Don't ask first.")]
    yes: bool,
}

#[derive(Subcommand)]
enum Action {
    #[command(about = "Show what would be made and what it costs. Changes nothing.")]
    Plan(Choice),
    #[command(about = "Compare monthly costs across clouds and sizes.")]
    Cost {
        #[arg(
            long,
            value_name = "GB",
            help = "How much data you expect (default 50)."
        )]
        data: Option<u32>,
    },
    #[command(about = "List the deployments set up from this machine.")]
    List,
    #[command(about = "Show whether it's running, and where.")]
    Status(Where),
    #[command(about = "Print the services' logs.")]
    Logs {
        #[arg(help = "One service: api, console, zero, postgres or s3.")]
        service: Option<String>,
        #[arg(long, short, help = "Keep printing as new lines come.")]
        follow: bool,
        #[arg(long, default_value_t = 200, help = "How many lines back to start.")]
        lines: u32,
        #[command(flatten)]
        place: Where,
    },
    #[command(about = "Check the deployment and what it needs, with a fix for each problem.")]
    Doctor(Where),
    #[command(about = "Move to a new release: fetch it, then restart service by service.")]
    Upgrade {
        #[arg(
            long = "image-version",
            value_name = "VERSION",
            help = "The release (default: the one in the settings)."
        )]
        version: Option<String>,
        #[command(flatten)]
        place: Where,
    },
    #[command(about = "Stop the services. Keeps the data; `skywake deploy` starts them again.")]
    Stop(Where),
    #[command(about = "Delete the deployment and all its data. Names everything first.")]
    Destroy {
        #[command(flatten)]
        place: Where,
        #[arg(long, short = 'y', help = "Don't ask first.")]
        yes: bool,
    },
}

pub(crate) async fn run(global: &Global, deploy: Deploy) -> Result<()> {
    let ui = Ui::new(global.json);
    let outcome = match deploy.action {
        None => up(&ui, deploy.choice).await,
        Some(Action::Plan(choice)) => plan_only(&ui, choice).await,
        Some(Action::Cost { data }) => cost(&ui, data),
        Some(Action::List) => list(&ui),
        Some(Action::Status(place)) => {
            let (_, settings) = existing(&place)?;
            local_only(&settings)?;
            local::status(&ui, &settings).await
        }
        Some(Action::Logs {
            service,
            follow,
            lines,
            place,
        }) => {
            let (_, settings) = existing(&place)?;
            local_only(&settings)?;
            local::logs(&settings, service.as_deref(), follow, lines).await?;
            return Ok(());
        }
        Some(Action::Doctor(place)) => doctor(&ui, &place).await,
        Some(Action::Upgrade { version, place }) => {
            let (path, mut settings) = existing(&place)?;
            local_only(&settings)?;
            if let Some(version) = version {
                settings.images.version = version;
                settings.save(&path)?;
            }
            local::upgrade(&ui, &settings).await
        }
        Some(Action::Stop(place)) => {
            let (_, settings) = existing(&place)?;
            local_only(&settings)?;
            local::stop(&ui, &settings).await
        }
        Some(Action::Destroy { place, yes }) => destroy(&ui, &place, yes).await,
    };
    finish(&ui, outcome)
}

fn finish(ui: &Ui, outcome: Result<Value>) -> Result<()> {
    match outcome {
        Ok(value) => {
            if ui.json {
                println!("{}", json!({ "result": value }));
            }
            Ok(())
        }
        Err(error) if ui.json => {
            println!("{}", json!({ "error": format!("{error:#}") }));
            std::process::exit(1);
        }
        Err(error) => {
            ui.failure(&error);
            std::process::exit(1);
        }
    }
}

fn local_only(settings: &Settings) -> Result<()> {
    match settings.target {
        Target::Local => Ok(()),
        other => bail!(
            "`{}` targets {other}, and deploying to {other} isn't built yet: only `local` runs today",
            settings.name
        ),
    }
}

fn existing(place: &Where) -> Result<(PathBuf, Settings)> {
    if let Some(found) = settings::find(place.config.as_deref(), place.name.as_deref())? {
        return Ok(found);
    }
    let saved = settings::saved()?;
    match (&place.name, saved.as_slice()) {
        (Some(name), _) => bail!("no deployment named `{name}`: `skywake deploy list` shows them"),
        (None, []) => bail!("nothing is deployed from here yet: `skywake deploy` sets one up"),
        (None, _) => {
            let names: Vec<&str> = saved.iter().map(|(_, s)| s.name.as_str()).collect();
            bail!("which one? pass --name {}", names.join(" or --name "))
        }
    }
}

async fn resolve(ui: &Ui, choice: &Choice, guided: bool) -> Result<(PathBuf, Settings, bool)> {
    let found = settings::find(choice.place.config.as_deref(), choice.place.name.as_deref())?;
    let fresh = found.is_none();
    let (path, mut settings) = match found {
        Some(found) => found,
        None => {
            let detected = Found::look().await;
            let target = match choice.target {
                Some(target) => target,
                None if guided && ui.interactive => pick_target(ui, &detected)?,
                None => detected.best(),
            };
            let size = match choice.size {
                Some(size) => size,
                None if guided && ui.interactive && target != Target::Local => {
                    pick_size(ui, target, choice.data)?
                }
                None => Size::Small,
            };
            let name = (choice.place.name.clone()).unwrap_or_else(|| match target {
                Target::Local => "local".to_string(),
                _ => "skywake".to_string(),
            });
            let settings = Settings::new(&name, target, size);
            let path = match &choice.place.config {
                Some(path) => path.clone(),
                None => folder(&name)?.join(FILE),
            };
            (path, settings)
        }
    };
    if let Some(target) = choice.target {
        if target != settings.target {
            settings.region = target.default_region().map(String::from);
        }
        settings.target = target;
    }
    let set = |field: &mut Option<String>, value: &Option<String>| {
        if value.is_some() {
            field.clone_from(value);
        }
    };
    set(&mut settings.region, &choice.region);
    set(&mut settings.domain, &choice.domain);
    set(&mut settings.bucket, &choice.bucket);
    set(&mut settings.host, &choice.host);
    if let Some(size) = choice.size {
        settings.size = size;
    }
    if let Some(data) = choice.data {
        settings.data_gb = data;
    }
    if let Some(database) = choice.database {
        settings.database = database;
    }
    if let Some(registry) = &choice.registry {
        settings.images.registry.clone_from(registry);
    }
    if let Some(version) = &choice.version {
        settings.images.version.clone_from(version);
    }
    settings.check()?;
    Ok((path, settings, fresh))
}

fn pick_target(ui: &Ui, detected: &Found) -> Result<Target> {
    let items: Vec<(Target, String)> = (Target::ALL.into_iter())
        .map(|target| {
            let mark = match detected.ready(target) {
                true => accent("●"),
                false => dim("○"),
            };
            let label = format!(
                "{mark} {:<11} {}  {}",
                target.to_string(),
                target.about(),
                dim(detected.why(target))
            );
            (target, label)
        })
        .collect();
    let default = Target::ALL
        .iter()
        .position(|&t| t == detected.best())
        .unwrap_or(0);
    ui.choose("Where should Skywake run?", &items, default)
}

fn pick_size(ui: &Ui, target: Target, data: Option<u32>) -> Result<Size> {
    let items: Vec<(Size, String)> = (Size::ALL.into_iter())
        .map(|size| {
            let mut settings = Settings::new("x", target, size);
            settings.data_gb = data.unwrap_or(settings.data_gb);
            let cost = price::estimate(&settings).monthly;
            let money = match target.cloud() {
                true => format!("{:>6}/mo", price::money(cost)),
                false => "        ".to_string(),
            };
            (
                size,
                format!(
                    "{:<7} {}  {}",
                    size.to_string(),
                    accent(money),
                    dim(size.about())
                ),
            )
        })
        .collect();
    ui.choose("How big?", &items, 0)
}

fn show_plan(ui: &Ui, settings: &Settings, plan: &Plan) {
    let place = (settings.region.clone()).unwrap_or_else(|| settings.target.about().to_string());
    ui.section(&format!(
        "{} {}",
        accent("◆"),
        strong(format!("Plan · {}", settings.name))
    ));
    ui.quiet(format!(
        "  {} · {} · {place}",
        settings.target, settings.size
    ));
    ui.blank();
    let kind = plan
        .resources
        .iter()
        .map(|r| r.kind.len())
        .max()
        .unwrap_or(0);
    let name = plan
        .resources
        .iter()
        .map(|r| r.name.len())
        .max()
        .unwrap_or(0);
    for resource in &plan.resources {
        ui.note(format!(
            "  {} {} {} {}",
            good("+"),
            dim(left(resource.kind, kind)),
            strong(left(&resource.name, name)),
            dim(&resource.detail)
        ));
    }
    let cost = &plan.cost;
    ui.blank();
    if cost.lines.is_empty() {
        ui.note(format!(
            "  {} {}  {}",
            dim("cost"),
            accent(strong("$0/mo")),
            dim(&cost.note)
        ));
        return;
    }
    let item = cost
        .lines
        .iter()
        .map(|l| l.item.len())
        .max()
        .unwrap_or(0)
        .max(20);
    let mut lines: Vec<String> = (cost.lines.iter())
        .map(|line| {
            format!(
                "{} {}",
                left(&line.item, item),
                right(price::money(line.monthly), 8)
            )
        })
        .collect();
    lines.push(dim("┄".repeat(item + 9)));
    lines.push(format!(
        "{} {}",
        left(strong("per month"), item),
        right(accent(strong(price::money(cost.monthly))), 8)
    ));
    ui.card("estimated cost", &lines);
    ui.quiet(format!("  {}", cost.note));
}

async fn plan_only(ui: &Ui, choice: Choice) -> Result<Value> {
    let (path, settings, _) = resolve(ui, &choice, false).await?;
    let plan = plan::plan(&settings);
    show_plan(ui, &settings, &plan);
    ui.blank();
    ui.quiet(format!(
        "Nothing changed. Settings would go to {}",
        ui::tilde(&path)
    ));
    Ok(json!({ "plan": plan, "settings": settings, "path": path }))
}

async fn up(ui: &Ui, choice: Choice) -> Result<Value> {
    let guided = choice.target.is_none() && choice.size.is_none();
    if guided {
        ui.banner("deploy · your own Skywake, anywhere");
    }
    let (path, mut settings, fresh) = resolve(ui, &choice, true).await?;
    let plan = plan::plan(&settings);
    show_plan(ui, &settings, &plan);
    ui.blank();
    if !plan.ready {
        settings.save(&path)?;
        bail!(
            "deploying to {} isn't built yet: only `local` runs today\nsettings saved to {} for when it is",
            settings.target,
            ui::tilde(&path)
        );
    }
    let verb = if fresh { "Deploy" } else { "Apply" };
    if !ui.confirm(&format!("{verb} {}?", settings.name), choice.yes)? {
        bail!("stopped: nothing changed");
    }
    ui.blank();
    let result = local::apply(ui, &mut settings, &path).await?;
    done(ui, &settings, &result);
    Ok(result)
}

fn done(ui: &Ui, settings: &Settings, result: &Value) {
    let profile = result["profile"].as_str().unwrap_or(&settings.name);
    let field = |name: &str| result[name].as_str().unwrap_or_default().to_string();
    let mut lines = vec![
        format!("{}  {}", dim("console"), accent(field("console"))),
        format!("{}      {}", dim("api"), accent(field("api"))),
        format!("{}  {}", dim("profile"), strong(profile)),
        format!("{}     {}", dim("cost"), "$0/mo, runs on this machine"),
        String::new(),
        dim("try it"),
        format!("  skywake --profile {profile} indexes"),
        format!("  skywake --profile {profile} create index products"),
        dim("look after it"),
        "  skywake deploy status · logs · doctor · stop".to_string(),
    ];
    if result["new_key"] == json!(true) {
        lines.insert(
            4,
            format!(
                "{}      {}",
                dim("key"),
                "an admin key, saved to this profile"
            ),
        );
    }
    ui.blank();
    ui.card("Skywake is up", &lines);
    ui.blank();
}

fn cost(ui: &Ui, data: Option<u32>) -> Result<Value> {
    let clouds = [Target::Aws, Target::Gcp, Target::Azure];
    let mut rows = Vec::new();
    for size in Size::ALL {
        let mut cells = Vec::new();
        for target in clouds {
            let mut settings = Settings::new("x", target, size);
            settings.data_gb = data.unwrap_or(settings.data_gb);
            cells.push(price::estimate(&settings).monthly);
        }
        rows.push((size, cells));
    }
    let data_gb = data.unwrap_or(50);
    ui.section(&format!(
        "{} {}",
        accent("◆"),
        strong(format!("Monthly cost · {data_gb} GB of data"))
    ));
    ui.blank();
    let head: Vec<String> = ["aws", "gcp", "azure"]
        .iter()
        .map(|c| right(dim(c), 8))
        .collect();
    ui.note(format!("  {} {}", left("", 7), head.join("")));
    let top = (rows.iter())
        .map(|(_, cells)| cells.iter().copied().fold(f64::INFINITY, f64::min))
        .fold(0.0, f64::max)
        .sqrt();
    for (size, cells) in &rows {
        let low = cells.iter().copied().fold(f64::INFINITY, f64::min);
        let shown: Vec<String> = (cells.iter())
            .map(|&value| match value == low {
                true => right(accent(strong(price::money(value))), 8),
                false => right(price::money(value), 8),
            })
            .collect();
        let blocks = ((low.sqrt() / top) * 14.0).round().max(1.0) as usize;
        ui.note(format!(
            "  {} {}   {}  {}",
            left(strong(size), 7),
            shown.join(""),
            left(ui.bar(blocks), 14),
            dim(size.about())
        ));
    }
    ui.blank();
    for (name, about) in [
        ("local", "on this machine, in Docker"),
        ("docker", "on a server you already pay for"),
    ] {
        ui.note(format!(
            "  {} {}   {}",
            left(strong(name), 7),
            right(accent("$0"), 8),
            dim(about)
        ));
    }
    ui.blank();
    ui.quiet(format!(
        "  cheapest in blue · on-demand list prices, {} · no tax or traffic",
        price::AS_OF
    ));
    ui.quiet(format!(
        "  itemized: {}",
        accent("skywake deploy plan --target aws --size small")
    ));
    let matrix: Vec<Value> = (rows.iter())
        .map(|(size, cells)| json!({ "size": size, "aws": cells[0], "gcp": cells[1], "azure": cells[2] }))
        .collect();
    Ok(json!({ "data_gb": data_gb, "as_of": price::AS_OF, "monthly": matrix }))
}

fn list(ui: &Ui) -> Result<Value> {
    let saved = settings::saved()?;
    if saved.is_empty() {
        ui.quiet("Nothing deployed from here yet: `skywake deploy` sets one up.");
    }
    for (path, settings) in &saved {
        let monthly = price::estimate(settings).monthly;
        ui.note(format!(
            "{} {:<16} {:<11} {:<7} {:>7}/mo  {}",
            accent("◆"),
            strong(&settings.name),
            settings.target.to_string(),
            settings.size.to_string(),
            price::money(monthly),
            dim(ui::tilde(path))
        ));
    }
    let items: Vec<Value> = (saved.iter())
        .map(|(path, s)| json!({ "name": s.name, "target": s.target, "size": s.size, "settings": path }))
        .collect();
    Ok(json!({ "deployments": items }))
}

async fn doctor(ui: &Ui, place: &Where) -> Result<Value> {
    let settings = match settings::find(place.config.as_deref(), place.name.as_deref())? {
        Some((_, settings)) => settings,
        None => Settings::new("local", Target::Local, Size::Small),
    };
    let (value, ok) = doctor::run(ui, &settings).await?;
    if !ok {
        if ui.json {
            println!("{}", json!({ "result": value }));
        }
        std::process::exit(1);
    }
    Ok(value)
}

async fn destroy(ui: &Ui, place: &Where, yes: bool) -> Result<Value> {
    let (path, settings) = existing(place)?;
    local_only(&settings)?;
    ui.section(&format!(
        "This deletes {} for good:",
        strong(&settings.name)
    ));
    for item in local::doomed(&settings)? {
        ui.note(format!("{} {item}", ui::bad("−")));
    }
    if !in_folder(&path, &settings) {
        ui.note(format!(
            "{} {} stays: it's yours",
            dim("·"),
            ui::tilde(&path)
        ));
    }
    ui.blank();
    if !ui.confirm(&format!("Destroy {}?", settings.name), yes)? {
        bail!("stopped: nothing changed");
    }
    local::destroy(ui, &settings).await
}

fn in_folder(path: &Path, settings: &Settings) -> bool {
    folder(&settings.name).is_ok_and(|dir| path.starts_with(dir))
}
