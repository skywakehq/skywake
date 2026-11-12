import type { StructuredData } from "fumadocs-core/mdx-plugins/remark-structure";
import type { StaticSource } from "fumadocs-core/source";
import spec from "@/generated/cli.json";
import type { CliArg, CliCommand } from "./types";

interface CliPageData {
  title: string;
  description?: string;
  command: CliCommand;
  structuredData: StructuredData;
}

type CliSource = StaticSource<{
  pageData: CliPageData;
  metaData: { title?: string; icon?: string; pages?: string[] };
}>;

const root = spec as CliCommand;
const baseDir = "reference/cli";

export function cliSource(): CliSource {
  const files: CliSource["files"] = [];
  const visit = (command: CliCommand) => {
    const folder = [baseDir, ...command.path].join("/");
    if (command.subcommands.length === 0) {
      files.push({ type: "page", path: `${folder}.mdx`, data: page(command) });
      return;
    }
    files.push({ type: "page", path: `${folder}/index.mdx`, data: page(command) });
    files.push({
      type: "meta",
      path: `${folder}/meta.json`,
      data: {
        title: command.path.length ? title(command) : "CLI",
        icon: command.path.length ? undefined : "SquareTerminal",
        pages: command.subcommands.map((sub) => sub.name),
      },
    });
    command.subcommands.forEach(visit);
  };
  visit(root);
  return { files };
}

export function title(command: CliCommand): string {
  return ["skywake", ...command.path].join(" ");
}

export function flag(arg: CliArg): string {
  if (arg.positional) return arg.valueNames.map((name) => `<${name}>`).join(" ");
  const names = [arg.short && `-${arg.short}`, arg.long && `--${arg.long}`].filter(Boolean);
  const value = arg.valueNames.map((name) => `<${name}>`).join(" ");
  return [names.join(", "), value].filter(Boolean).join(" ");
}

function page(command: CliCommand): CliPageData {
  const help = (arg: CliArg) => arg.longHelp ?? arg.help ?? "";
  return {
    title: title(command),
    description: command.about ?? undefined,
    command,
    structuredData: {
      headings: [],
      contents: [
        {
          heading: undefined,
          content: [command.longAbout ?? command.about ?? "", command.usage].join("\n"),
        },
        ...command.args.map((arg) => ({
          heading: undefined,
          content: `${flag(arg)} ${help(arg)}`,
        })),
      ],
    },
  };
}
