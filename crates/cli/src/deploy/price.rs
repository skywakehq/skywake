use serde::Serialize;

use super::settings::{Database, Settings, Size, Target};

pub(crate) const AS_OF: &str = "2026-06";

const HOURS: f64 = 730.0;

struct Book {
    region: &'static str,
    servers: [(&'static str, f64); 4],
    disk_gb: f64,
    bucket_gb: f64,
    address: f64,
    databases: [(&'static str, f64); 2],
    database_gb: f64,
    cluster: f64,
    balancer: f64,
    gateway: f64,
}

const AWS: Book = Book {
    region: "us-east-1",
    servers: [
        ("EC2 t4g.small · 2 vCPU · 2 GB", 0.0168),
        ("EC2 t4g.medium · 2 vCPU · 4 GB", 0.0336),
        ("EC2 t4g.large · 2 vCPU · 8 GB", 0.0672),
        ("EC2 t4g.large · 2 vCPU · 8 GB", 0.0672),
    ],
    disk_gb: 0.08,
    bucket_gb: 0.023,
    address: 0.005,
    databases: [
        ("RDS Postgres db.t4g.small", 0.032),
        ("RDS Postgres db.t4g.medium", 0.065),
    ],
    database_gb: 0.115,
    cluster: 0.10,
    balancer: 0.0225,
    gateway: 0.045,
};

const GCP: Book = Book {
    region: "us-central1",
    servers: [
        ("Compute e2-small · 2 vCPU · 2 GB", 0.016751),
        ("Compute e2-medium · 2 vCPU · 4 GB", 0.033503),
        ("Compute e2-standard-2 · 2 vCPU · 8 GB", 0.067006),
        ("Compute e2-standard-2 · 2 vCPU · 8 GB", 0.067006),
    ],
    disk_gb: 0.10,
    bucket_gb: 0.020,
    address: 0.005,
    databases: [
        ("Cloud SQL Postgres db-g1-small", 0.035),
        ("Cloud SQL Postgres 2 vCPU · 7.5 GB", 0.1351),
    ],
    database_gb: 0.17,
    cluster: 0.0,
    balancer: 0.025,
    gateway: 0.0,
};

const AZURE: Book = Book {
    region: "eastus",
    servers: [
        ("VM B1ms · 1 vCPU · 2 GB", 0.0207),
        ("VM B2s · 2 vCPU · 4 GB", 0.0416),
        ("VM B2ms · 2 vCPU · 8 GB", 0.0832),
        ("VM B2ms · 2 vCPU · 8 GB", 0.0832),
    ],
    disk_gb: 0.075,
    bucket_gb: 0.018,
    address: 0.005,
    databases: [
        ("Postgres Flexible B1ms", 0.017),
        ("Postgres Flexible B2ms", 0.068),
    ],
    database_gb: 0.115,
    cluster: 0.0,
    balancer: 0.025,
    gateway: 0.0,
};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Line {
    pub item: String,
    pub monthly: f64,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Estimate {
    pub lines: Vec<Line>,
    pub monthly: f64,
    pub region: Option<String>,
    pub note: String,
}

fn book(target: Target) -> Option<&'static Book> {
    match target {
        Target::Aws => Some(&AWS),
        Target::Gcp => Some(&GCP),
        Target::Azure => Some(&AZURE),
        _ => None,
    }
}

pub(crate) fn disk_gb(size: Size) -> u32 {
    match size {
        Size::Tiny => 20,
        Size::Small => 30,
        Size::Medium | Size::Large => 50,
    }
}

pub(crate) fn server(target: Target, size: Size) -> Option<&'static str> {
    let index = (size as usize).min(3);
    book(target).map(|book| book.servers[index].0)
}

pub(crate) fn estimate(settings: &Settings) -> Estimate {
    let Some(book) = book(settings.target) else {
        return free(settings.target);
    };
    let size = settings.size;
    let data = f64::from(settings.data_gb);
    let mut lines = Vec::new();
    let mut add = |item: String, monthly: f64| {
        if monthly > 0.0 {
            let monthly = (monthly * 100.0).round() / 100.0;
            lines.push(Line { item, monthly });
        }
    };
    let (server, hourly) = book.servers[size as usize];
    let disk = f64::from(disk_gb(size));
    match size.clustered() {
        false => {
            add(server.to_string(), hourly * HOURS);
            add(format!("{disk} GB disk"), disk * book.disk_gb);
            add("public IPv4 address".into(), book.address * HOURS);
        }
        true => {
            add(format!("3 × {server}"), 3.0 * hourly * HOURS);
            add(format!("3 × {disk} GB disk"), 3.0 * disk * book.disk_gb);
            add("Kubernetes control plane".into(), book.cluster * HOURS);
            add("load balancer".into(), book.balancer * HOURS);
            if book.gateway > 0.0 {
                add("NAT gateway".into(), book.gateway * HOURS);
            }
        }
    }
    if settings.database == Database::Managed {
        let (database, hourly) = book.databases[usize::from(size.clustered())];
        add(database.to_string(), hourly * HOURS);
        add("20 GB database storage".into(), 20.0 * book.database_gb);
    }
    add(format!("{data} GB in the bucket"), data * book.bucket_gb);
    let monthly = (lines.iter().map(|line| line.monthly).sum::<f64>() * 100.0).round() / 100.0;
    let mut note = format!("On-demand list prices in {}, {AS_OF}.", book.region);
    note.push_str(" Leaves out tax, traffic out and request charges.");
    if size.clustered() && book.cluster == 0.0 {
        note.push_str(" The control plane is on the free tier.");
    }
    Estimate {
        lines,
        monthly,
        region: Some(book.region.to_string()),
        note,
    }
}

fn free(target: Target) -> Estimate {
    let note = match target {
        Target::Local => "Runs on this machine: nothing to pay.",
        Target::Docker => "Runs on your server: you pay only for it.",
        _ => "Runs on your cluster: you pay only for its nodes and volumes.",
    };
    Estimate {
        lines: Vec::new(),
        monthly: 0.0,
        region: None,
        note: note.to_string(),
    }
}

pub(crate) fn money(monthly: f64) -> String {
    match monthly {
        0.0 => "$0".to_string(),
        m if m < 10.0 => format!("${m:.2}"),
        m => format!("${:.0}", m.round()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monthly(target: Target, size: Size) -> f64 {
        estimate(&Settings::new("a", target, size)).monthly
    }

    #[test]
    fn small_deployments_stay_cheap() {
        for target in [Target::Aws, Target::Gcp, Target::Azure] {
            let tiny = monthly(target, Size::Tiny);
            assert!((10.0..30.0).contains(&tiny), "{target} tiny is {tiny}");
            assert!(tiny < monthly(target, Size::Small));
            assert!(monthly(target, Size::Small) < monthly(target, Size::Medium));
            assert!(monthly(target, Size::Medium) < monthly(target, Size::Large));
        }
    }

    #[test]
    fn aws_tiny_adds_up() {
        let estimate = estimate(&Settings::new("a", Target::Aws, Size::Tiny));
        let expected = 0.0168 * 730.0 + 20.0 * 0.08 + 0.005 * 730.0 + 50.0 * 0.023;
        assert!((estimate.monthly - expected).abs() < 0.01);
        assert_eq!(estimate.lines.len(), 4);
    }

    #[test]
    fn local_costs_nothing() {
        assert_eq!(monthly(Target::Local, Size::Large), 0.0);
        assert_eq!(money(0.0), "$0");
        assert_eq!(money(4.5), "$4.50");
        assert_eq!(money(18.38), "$18");
    }
}
