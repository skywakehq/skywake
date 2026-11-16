mod account;
mod files;
mod keys;
mod mcp;
mod places;
mod rows;
mod types;

use anyhow::{Result, bail};

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
        Command::Disks => places::disks(session).await,
        Command::Indexes => places::indexes(session).await,
        Command::Create { what } => places::create(session, what).await,
        Command::Destroy { target, confirm } => {
            places::destroy(session, &Target::place(&target)?, confirm.yes).await
        }
        Command::Branches { name } => places::branches(session, &Target::place(&name)?).await,
        Command::Fork { target, new, from } => {
            places::fork(session, &Target::place(&target)?, &new, from).await
        }
        Command::Merge {
            target,
            into,
            message,
            dry_run,
        } => places::merge(session, &Target::place(&target)?, &into, message, dry_run).await,
        Command::Log {
            target,
            path,
            limit,
        } => places::log(session, &Target::place(&target)?, path, limit).await,
        Command::Diff { target, against } => {
            places::diff(session, &Target::place(&target)?, &against).await
        }
        Command::List {
            target,
            recursive,
            at,
        } => files::list(session, &Target::parse(&target)?, recursive, at).await,
        Command::Read { target, at } => files::read(session, &Target::parse(&target)?, at).await,
        Command::Write {
            target,
            file,
            message,
            executable,
        } => files::write(session, &Target::parse(&target)?, file, message, executable).await,
        Command::Delete {
            target,
            more,
            message,
        } => {
            let parsed = Target::parse(&target)?;
            match parsed.path {
                Some(_) => files::delete(session, &parsed, more, message).await,
                None => rows::delete(session, &Target::place(&target)?, more).await,
            }
        }
        Command::Grep {
            pattern,
            target,
            glob,
            ignore_case,
            limit,
            at,
        } => {
            let target = Target::parse(&target)?;
            files::grep(session, &pattern, &target, glob, ignore_case, limit, at).await
        }
        Command::Find {
            glob,
            target,
            kind,
            limit,
            at,
        } => files::find(session, &glob, &Target::parse(&target)?, kind, limit, at).await,
        Command::Upload {
            dir,
            target,
            message,
        } => files::upload(session, &dir, &Target::place(&target)?, message).await,
        Command::Download { target, dir, at } => {
            files::download(session, &Target::place(&target)?, &dir, at).await
        }
        Command::Upsert {
            target,
            file,
            format,
        } => rows::upsert(session, &Target::place(&target)?, file, format).await,
        Command::Get { target, id } => rows::get(session, &Target::place(&target)?, &id).await,
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
            rows::query(session, &Target::place(&target)?, search).await
        }
        Command::Keys { action } => keys::run(session, action).await,
        Command::Types { out } => types::run(session, &out).await,
        Command::Gc { .. } | Command::Recover { .. } => {
            bail!("this works on a store with no server: add --local [DIR]")
        }
        _ => unreachable!("handled before the session"),
    }
}
