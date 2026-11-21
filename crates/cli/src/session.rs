use std::io::{BufRead, IsTerminal, Write};

use anyhow::{Result, bail};
use skywake::{ErrorKind, Skywake};

use crate::cli::Global;
use crate::target::Target;

pub(crate) struct Session {
    pub(crate) sky: Skywake,
    pub(crate) json: bool,
}

impl Session {
    pub(crate) fn open(global: &Global) -> Result<Session> {
        let mut builder = Skywake::builder();
        if let Some(key) = global.key.as_deref().filter(|key| !key.is_empty()) {
            builder = builder.key(key);
        }
        if let Some(url) = &global.url {
            builder = builder.url(url);
        }
        if let Some(environment) = &global.environment {
            builder = builder.environment(environment);
        }
        if let Some(profile) = &global.profile {
            builder = builder.profile(profile);
        }
        Ok(Session {
            sky: builder.build()?,
            json: global.json,
        })
    }

    pub(crate) fn disk(&self, target: &Target) -> skywake::Disk {
        self.sky.disk(&target.name).on(target.branch())
    }

    pub(crate) async fn found(&self, target: &Target) -> Result<skywake::Disk> {
        let disk = self.disk(target);
        match disk.info().await {
            Ok(_) => Ok(disk),
            Err(error) if error.kind() == Some(&ErrorKind::NotFound) => {
                bail!("no disk named `{}`; see `skywake disks`", target.name)
            }
            Err(error) => Err(error.into()),
        }
    }
}

pub(crate) fn confirm(question: &str, yes: bool) -> Result<()> {
    if yes {
        return Ok(());
    }
    let stdin = std::io::stdin();
    if !stdin.is_terminal() {
        bail!("{question} Pass --yes to do it without asking.");
    }
    eprint!("{question} [y/N] ");
    std::io::stderr().flush()?;
    let mut answer = String::new();
    stdin.lock().read_line(&mut answer)?;
    match answer.trim().to_lowercase().as_str() {
        "y" | "yes" => Ok(()),
        _ => bail!("stopped; nothing changed"),
    }
}
