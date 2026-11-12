//! `skywake __docs-spec`: the command tree as JSON. The docs site renders its
//! CLI reference from it, so the pages say what `--help` says.

use clap::{Arg, ArgAction, Command};
use serde_json::{Value, json};

pub(crate) fn spec(mut command: Command) -> Value {
    // Building adds the help and version flags and copies global flags down,
    // as `--help` shows them.
    command.build();
    describe(&mut command, Vec::new())
}

/// `path` is the subcommand names after `skywake`, empty for the root.
fn describe(command: &mut Command, path: Vec<String>) -> Value {
    let args: Vec<Value> = command
        .get_arguments()
        .filter(|arg| !arg.is_hide_set())
        .map(describe_arg)
        .collect();
    let subcommands: Vec<Value> = command
        .get_subcommands_mut()
        .filter(|sub| !sub.is_hide_set() && sub.get_name() != "help")
        .map(|sub| {
            let name = sub.get_name().to_string();
            describe(sub, [path.clone(), vec![name]].concat())
        })
        .collect();
    json!({
        "name": command.get_name(),
        "path": path,
        "about": command.get_about().map(ToString::to_string),
        "longAbout": command.get_long_about().map(ToString::to_string),
        "usage": command.render_usage().to_string().trim_start_matches("Usage: ").to_string(),
        "afterHelp": command.get_after_help().map(ToString::to_string),
        "args": args,
        "subcommands": subcommands,
    })
}

fn describe_arg(arg: &Arg) -> Value {
    let flag = !matches!(arg.get_action(), ArgAction::Set | ArgAction::Append);
    let defaults: Vec<String> = if arg.is_hide_default_value_set() {
        Vec::new()
    } else {
        arg.get_default_values()
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    };
    let values: Vec<String> = arg
        .get_possible_values()
        .iter()
        .filter(|value| !value.is_hide_set())
        .map(|value| value.get_name().to_string())
        .collect();
    json!({
        "id": arg.get_id().as_str(),
        "long": arg.get_long(),
        "short": arg.get_short().map(String::from),
        "valueNames": if flag { Vec::new() } else { arg.get_value_names().map(|names| names.iter().map(ToString::to_string).collect()).unwrap_or_else(|| vec![arg.get_id().as_str().to_uppercase()]) },
        "positional": arg.is_positional(),
        "required": arg.is_required_set(),
        "multiple": matches!(arg.get_action(), ArgAction::Append) || arg.get_num_args().is_some_and(|range| range.max_values() > 1),
        "global": arg.is_global_set(),
        "help": arg.get_help().map(ToString::to_string),
        "longHelp": arg.get_long_help().map(ToString::to_string),
        "default": defaults,
        "env": arg.get_env().map(|env| env.to_string_lossy().into_owned()),
        "values": values,
    })
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::spec;

    /// The docs site reads this file. Rewrite it with
    /// `UPDATE_DOCS_SPEC=1 cargo test -p skywake-cli docs_spec`.
    #[test]
    fn docs_spec_is_current() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/docs/generated/cli.json"
        );
        let current = serde_json::to_string_pretty(&spec(crate::Cli::command())).unwrap() + "\n";
        if std::env::var_os("UPDATE_DOCS_SPEC").is_some() {
            std::fs::write(path, &current).unwrap();
            return;
        }
        let saved = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            saved == current,
            "apps/docs/generated/cli.json is out of date; run `UPDATE_DOCS_SPEC=1 cargo test -p skywake-cli docs_spec`"
        );
    }
}
