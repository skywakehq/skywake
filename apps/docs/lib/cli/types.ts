/** One command in `generated/cli.json`, as `crates/cli/src/docs_spec.rs` writes it. */
export interface CliCommand {
  name: string;
  /** Subcommand names after `skywake`; empty for `skywake` itself. */
  path: string[];
  about: string | null;
  longAbout: string | null;
  usage: string;
  afterHelp: string | null;
  args: CliArg[];
  subcommands: CliCommand[];
}

export interface CliArg {
  id: string;
  long: string | null;
  short: string | null;
  valueNames: string[];
  positional: boolean;
  required: boolean;
  multiple: boolean;
  global: boolean;
  help: string | null;
  longHelp: string | null;
  default: string[];
  env: string | null;
  values: string[];
}
