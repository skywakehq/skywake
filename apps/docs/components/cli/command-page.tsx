import Link from "fumadocs-core/link";
import type { TOCItemType } from "fumadocs-core/toc";
import { InlineCode } from "@/components/inline-code";
import { flag, title } from "@/lib/cli/source";
import type { CliArg, CliCommand } from "@/lib/cli/types";

export function CommandPage({ command }: { command: CliCommand }) {
  const positional = command.args.filter((arg) => arg.positional);
  const options = command.args.filter((arg) => !arg.positional);
  return (
    <>
      <pre className="sw-usage not-prose">skywake {command.usage.replace(/^skywake\s?/, "")}</pre>
      {command.longAbout && <Paragraphs text={command.longAbout} />}
      {command.subcommands.length > 0 && (
        <Section heading="Commands">
          {command.subcommands.map((sub) => (
            <Link key={sub.name} href={`/reference/cli/${sub.path.join("/")}`} className="sw-row">
              <code className="sw-row-name">{title(sub)}</code>
              <span className="sw-row-text">{sub.about && <InlineCode text={sub.about} />}</span>
            </Link>
          ))}
        </Section>
      )}
      {positional.length > 0 && <Args heading="Arguments" args={positional} />}
      {options.length > 0 && <Args heading="Options" args={options} />}
      {command.afterHelp && (
        <Section heading="Notes">
          <pre className="sw-help not-prose">{command.afterHelp}</pre>
        </Section>
      )}
    </>
  );
}

/** The page's sections, in the order `CommandPage` draws them. */
export function commandToc(command: CliCommand): TOCItemType[] {
  const sections = [
    command.subcommands.length > 0 && "Commands",
    command.args.some((arg) => arg.positional) && "Arguments",
    command.args.some((arg) => !arg.positional) && "Options",
    command.afterHelp && "Notes",
  ].filter((heading): heading is string => Boolean(heading));
  return sections.map((heading) => ({
    title: heading,
    url: `#${heading.toLowerCase()}`,
    depth: 2,
  }));
}

function Args({ heading, args }: { heading: string; args: CliArg[] }) {
  return (
    <Section heading={heading}>
      {args.map((arg) => (
        <div key={arg.id} className="sw-row">
          <code className="sw-row-name">{flag(arg)}</code>
          <div className="sw-row-text">
            <Paragraphs text={arg.longHelp ?? arg.help ?? ""} />
            <Facts arg={arg} />
          </div>
        </div>
      ))}
    </Section>
  );
}

function Facts({ arg }: { arg: CliArg }) {
  const facts = [
    arg.required && !arg.positional && ["required"],
    arg.default.length > 0 && ["default", arg.default.join(", ")],
    arg.values.length > 0 && ["one of", arg.values.join(", ")],
    arg.env && ["env", arg.env],
    arg.multiple && ["repeatable"],
  ].filter((fact): fact is string[] => Boolean(fact));
  if (facts.length === 0) return null;
  return (
    <ul className="sw-facts">
      {facts.map(([label, value]) => (
        <li key={label}>
          {label}
          {value && <code>{value}</code>}
        </li>
      ))}
    </ul>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  const id = heading.toLowerCase();
  return (
    <section>
      <h2 id={id}>{heading}</h2>
      <div className="sw-rows not-prose">{children}</div>
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph, i) => <p key={i}>{<InlineCode text={paragraph} />}</p>);
}
