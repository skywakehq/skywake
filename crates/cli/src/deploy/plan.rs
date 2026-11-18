use serde::Serialize;

use super::price::{self, Estimate};
use super::settings::{Database, Settings, Target};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Resource {
    pub kind: &'static str,
    pub name: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Plan {
    pub name: String,
    pub target: Target,
    pub resources: Vec<Resource>,
    pub cost: Estimate,
    pub ready: bool,
}

pub(crate) fn plan(settings: &Settings) -> Plan {
    let mut resources = Vec::new();
    let mut add = |kind: &'static str, name: String, detail: String| {
        resources.push(Resource { kind, name, detail })
    };
    let name = &settings.name;
    let bucket = (settings.bucket.clone()).unwrap_or_else(|| format!("{name}-data"));
    let reuse = match settings.bucket.is_some() {
        true => "yours, kept as it is",
        false => "made for this deployment",
    };
    match settings.target {
        Target::Local | Target::Docker => {
            let place = match settings.target {
                Target::Local => "this machine".to_string(),
                _ => settings.host.clone().unwrap_or_default(),
            };
            let ports = settings.ports;
            add(
                "container",
                "api".into(),
                format!("port {} on {place}", ports.api),
            );
            add(
                "container",
                "console".into(),
                format!("port {}", ports.console),
            );
            add(
                "container",
                "zero".into(),
                format!("port {}, keeps the console live", ports.zero),
            );
            match settings.database {
                Database::External => add(
                    "database",
                    "postgres".into(),
                    "yours, from SKYWAKE_DATABASE_URL".into(),
                ),
                _ => add(
                    "container",
                    "postgres".into(),
                    "Postgres 17, data in a volume".into(),
                ),
            }
            match settings.bucket.is_some() {
                true => add("bucket", bucket, reuse.into()),
                false => add(
                    "container",
                    "s3".into(),
                    "S3-compatible store, data in a volume".into(),
                ),
            }
        }
        Target::Kubernetes => {
            add("namespace", name.clone(), "everything installs here".into());
            add("helm release", name.clone(), "api, console, zero".into());
            add("bucket", bucket, reuse.into());
            add(
                "database",
                "postgres".into(),
                database(settings.database).into(),
            );
        }
        cloud => {
            let region = settings.region.clone().unwrap_or_default();
            let server = price::server(cloud, settings.size).unwrap_or_default();
            match settings.size.clustered() {
                false => {
                    add("server", name.clone(), format!("{server} in {region}"));
                    add("address", name.clone(), "a fixed public address".into());
                }
                true => {
                    add("cluster", name.clone(), format!("Kubernetes, 3 × {server}"));
                    add(
                        "load balancer",
                        name.clone(),
                        "HTTPS in front of the console and API".into(),
                    );
                }
            }
            add("bucket", bucket, reuse.into());
            add(
                "database",
                "postgres".into(),
                database(settings.database).into(),
            );
            add(
                "identity",
                format!("{name}-runtime"),
                "reads and writes only this bucket".into(),
            );
            add(
                "secrets",
                format!("{name}/*"),
                "kept in the cloud's secret manager".into(),
            );
        }
    }
    let images = &settings.images;
    match &images.source {
        Some(source) => add(
            "images",
            "built here".into(),
            format!("from {}", super::ui::tilde(source)),
        ),
        None => add(
            "images",
            "published".into(),
            format!("{}/… {}", images.registry, images.version),
        ),
    }
    if let Some(domain) = &settings.domain {
        add(
            "domain",
            domain.clone(),
            "HTTPS with an automatic certificate".into(),
        );
    }
    Plan {
        name: name.clone(),
        target: settings.target,
        resources,
        cost: price::estimate(settings),
        ready: settings.target == Target::Local,
    }
}

fn database(database: Database) -> &'static str {
    match database {
        Database::Bundled => "Postgres on the server, backed up nightly to the bucket",
        Database::Managed => "managed Postgres with daily backups",
        Database::External => "yours, from SKYWAKE_DATABASE_URL",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deploy::settings::Size;

    #[test]
    fn plans_name_what_they_make() {
        let local = plan(&Settings::new("dev", Target::Local, Size::Tiny));
        assert!(local.ready);
        assert!(local.resources.iter().any(|r| r.name == "s3"));
        let aws = plan(&Settings::new("prod", Target::Aws, Size::Large));
        assert!(!aws.ready);
        assert!(aws.resources.iter().any(|r| r.kind == "cluster"));
        assert!(aws.resources.iter().any(|r| r.name == "prod-data"));
        assert!(aws.cost.monthly > 100.0);
    }
}
