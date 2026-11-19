mod account;
mod keys;
mod mcp;
mod places;
mod rows;
mod types;

use anyhow::Result;

use crate::cli::{Command, Global};
use crate::session::Session;
use crate::target::Target;

pub(crate) async fn run(global: &Global, command: Command) -> Result<()> {
    match command {
        Command::Login { paste } => return account::login(global, paste).await,
        Command::Logout => return account::logout(global),
        Command::Env { name } => return account::env(global, name).await,
        Command::Mcp { args } => return mcp::run(global, args),
        _ => {}
    }
    let session = Session::open(global)?;
    let session = &session;
    match command {
        Command::Whoami => account::whoami(session).await,
        Command::Indexes => places::indexes(session).await,
        Command::Create { what } => places::create(session, what).await,
        Command::Destroy { target, confirm } => {
            places::destroy(session, &Target::parse(&target)?, confirm.yes).await
        }
        Command::Branches { name } => places::branches(session, &Target::parse(&name)?).await,
        Command::Fork { target, new, from } => {
            places::fork(session, &Target::parse(&target)?, &new, from).await
        }
        Command::Merge { target, into } => {
            places::merge(session, &Target::parse(&target)?, &into).await
        }
        Command::Log { target, limit } => {
            places::log(session, &Target::parse(&target)?, limit).await
        }
        Command::Delete { target, ids } => {
            rows::delete(session, &Target::parse(&target)?, ids).await
        }
        Command::Upsert {
            target,
            file,
            format,
        } => rows::upsert(session, &Target::parse(&target)?, file, format).await,
        Command::Get { target, id } => rows::get(session, &Target::parse(&target)?, &id).await,
        Command::Query {
            target,
            text,
            filter,
            limit,
            mode,
            vector,
            sort,
            fields,
        } => {
            let search = rows::Search {
                text,
                filter,
                limit,
                mode,
                vector,
                sort,
                fields,
            };
            rows::query(session, &Target::parse(&target)?, search).await
        }
        Command::Keys { action } => keys::run(session, action).await,
        Command::Types { out } => types::run(session, &out).await,
        _ => unreachable!("handled before the session"),
    }
}
