use anyhow::Result;
use futures::TryStreamExt;
use serde_json::json;
use skywake::Role;

use crate::cli::{Keys, RoleArg};
use crate::output::{self, cell, table, time};
use crate::session::{Session, confirm};

pub(crate) async fn run(session: &Session, action: Option<Keys>) -> Result<()> {
    match action {
        None => list(session).await,
        Some(Keys::Create {
            role,
            name,
            only,
            all_environments,
            expires_in_days,
        }) => {
            let mut create = session.sky.create_key(&name, role_of(role));
            match (all_environments, session.sky.environment()) {
                (true, _) => {}
                (false, Some(environment)) => create = create.environment(environment.to_string()),
                (false, None) => {
                    let who = session.sky.whoami().await?;
                    if let Some(environment) = who.environment {
                        create = create.environment(environment);
                    }
                }
            }
            if !only.is_empty() {
                create = create.only(only);
            }
            if let Some(days) = expires_in_days {
                create = create.expires_in_days(days);
            }
            let made = create.send().await?;
            output::either(session.json, &made, |made| {
                println!("{}", made.key);
                eprintln!(
                    "Key {} made. It is shown only once: keep it somewhere safe.",
                    made.id
                );
            })
        }
        Some(Keys::Revoke { id, confirm: asked }) => {
            confirm(
                &format!("Revoke key {id}? Anything using it stops working."),
                asked.yes,
            )?;
            session.sky.revoke_key(&id).await?;
            output::report(
                session.json,
                json!({ "revoked": id }),
                format!("Revoked key {id}."),
            )
        }
    }
}

async fn list(session: &Session) -> Result<()> {
    let keys: Vec<_> = session.sky.list_keys().try_collect().await?;
    output::either(session.json, &keys, |keys| {
        let rows = keys
            .iter()
            .map(|key| {
                vec![
                    key.id.clone(),
                    key.name.clone(),
                    cell(&serde_json::to_value(key.role).unwrap_or_default()),
                    key.environment
                        .clone()
                        .unwrap_or_else(|| "every".to_string()),
                    key.only.join(", "),
                    key.last_used.as_deref().map(time).unwrap_or_default(),
                ]
            })
            .collect::<Vec<_>>();
        table(
            &["ID", "NAME", "ROLE", "ENVIRONMENT", "ONLY", "LAST USED"],
            &rows,
        );
    })
}

fn role_of(role: RoleArg) -> Role {
    match role {
        RoleArg::Read => Role::Read,
        RoleArg::Write => Role::Write,
        RoleArg::Admin => Role::Admin,
    }
}
