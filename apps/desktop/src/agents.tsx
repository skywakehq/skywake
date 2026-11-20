import { Braces, ChevronDown, MousePointer2, Sparkles, SquareTerminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@skywake/ui/lib/utils";
import { type Agent, type AgentPlan, desktop, tilde } from "./desktop";
import { AppIcon, Capsule, CopyButton, useDismiss } from "./ui";

const AGENTS: { id: Agent; name: string; icon: typeof SquareTerminal }[] = [
  { id: "claude-code", name: "Claude Code", icon: SquareTerminal },
  { id: "cursor", name: "Cursor", icon: MousePointer2 },
];

type Open = { kind: "add"; agent: (typeof AGENTS)[number]; plan: AgentPlan } | { kind: "config" };

/**
 * The toolbar's Agents menu. Agents can always work in the mounted folder;
 * this adds Skywake's MCP server, for search, history and branches.
 */
export function AgentsMenu({
  disk,
  branch,
  path,
  onNote,
}: {
  disk: string;
  branch: string;
  path?: string;
  onNote: (message: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const [config, setConfig] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    desktop.mcpConfig(disk, branch).then((text) => live && setConfig(text));
    return () => {
      live = false;
    };
  }, [disk, branch]);

  useDismiss(menu, () => setMenu(false), box);

  async function ask(agent: (typeof AGENTS)[number]) {
    setMenu(false);
    try {
      setOpen({ kind: "add", agent, plan: await desktop.agentPlan(agent.id, disk, branch) });
    } catch (failure) {
      onNote(String(failure));
    }
  }

  async function add(agent: (typeof AGENTS)[number]) {
    setOpen(null);
    try {
      const file = await desktop.agentAdd(agent.id, disk, branch);
      onNote(`Added to ${agent.name} in ${tilde(file)}. Restart it to pick it up.`);
    } catch (failure) {
      onNote(String(failure));
    }
  }

  return (
    <div ref={box} className="relative">
      <Capsule
        look="soft"
        onClick={() => setMenu(!menu)}
        className={cn("h-9 pr-2.5 pl-3", menu && "brightness-95 dark:brightness-150")}
      >
        <Sparkles className="text-secondary" />
        Agents
        <ChevronDown className="!size-3 text-tertiary" />
      </Capsule>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ type: "spring", duration: 0.32, bounce: 0.22 }}
            className="popover absolute top-11 right-0 z-50 w-[288px] origin-top-right rounded-[16px] p-1.5"
          >
            <p className="px-2.5 pt-1.5 pb-1.5 text-[11px] font-semibold text-tertiary">
              Add the Skywake MCP server to
            </p>
            {AGENTS.map((agent) => (
              <Item key={agent.id} icon={<agent.icon />} onClick={() => void ask(agent)}>
                {agent.name}…
              </Item>
            ))}
            <div className="mx-2.5 my-1.5 h-px bg-separator" />
            <Item icon={<Braces />} onClick={() => (setMenu(false), setOpen({ kind: "config" }))}>
              Config for another agent…
            </Item>
            <p className="mx-1 mt-1.5 rounded-[10px] bg-fill px-2.5 py-2 text-[11.5px] leading-4 text-secondary">
              {path
                ? "Any agent can also just work in the folder: it is plain files."
                : "Mount the disk and any agent can work in its folder too."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Over the whole window, sidebar too, as a sheet is. */}
      {createPortal(
        <AnimatePresence>
          {open?.kind === "add" && (
            <Sheet
              key="add"
              icon={<open.agent.icon />}
              title={`Add Skywake to ${open.agent.name}?`}
              onCancel={() => setOpen(null)}
              text={
                <>
                  {open.plan.replaces ? "This replaces the server " : "This adds one MCP server, "}
                  <code className="font-mono text-text">{open.plan.name}</code>, to the file below.
                  Nothing else in it changes.
                </>
              }
              file={tilde(open.plan.file)}
              code={open.plan.entry}
              actions={
                <>
                  <Capsule onClick={() => setOpen(null)} className="h-9 px-5">
                    Cancel
                  </Capsule>
                  <Capsule
                    look="prominent"
                    onClick={() => void add(open.agent)}
                    autoFocus
                    className="h-9 px-6"
                  >
                    {open.plan.replaces ? "Replace" : "Add"}
                  </Capsule>
                </>
              }
            />
          )}
          {open?.kind === "config" && (
            <Sheet
              key="config"
              icon={<Braces />}
              title="MCP config"
              onCancel={() => setOpen(null)}
              text={
                <>
                  Paste this into the MCP settings of your agent. It signs in with the key from{" "}
                  <code className="font-mono text-text">skywake login</code>.
                </>
              }
              file="mcp.json"
              code={config}
              actions={
                <>
                  <CopyButton text={config} label="Copy" className="h-9 px-5 text-[13px]" />
                  <Capsule
                    look="prominent"
                    onClick={() => setOpen(null)}
                    autoFocus
                    className="h-9 px-6"
                  >
                    Done
                  </Capsule>
                </>
              }
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function Item({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13px] hover:bg-fill-strong [&_svg]:size-3.5"
    >
      <span className="grid size-6 place-items-center rounded-[7px] bg-fill-strong text-secondary">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** A dialog over the whole window that says exactly what will happen. */
function Sheet({
  icon,
  title,
  text,
  file,
  code,
  actions,
  onCancel,
}: {
  icon: ReactNode;
  title: string;
  text: ReactNode;
  file: string;
  code: string;
  actions: ReactNode;
  onCancel: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onCancel]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-8 dark:bg-black/45"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <motion.div
        initial={{ scale: 0.9, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: "spring", duration: 0.45, bounce: 0.24 }}
        className="popover w-[500px] rounded-[26px] p-6"
      >
        {/* Skywake and the agent, joined: what the sheet is about to do. */}
        <div className="flex items-center">
          <AppIcon className="size-11 !shadow-[inset_0_0.5px_0_rgb(255_255_255/0.22),0_6px_14px_-6px_rgb(0_0_0/0.5)]" />
          <span className="mx-1.5 flex gap-[3px]">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18 }}
                className="size-[3px] rounded-full bg-secondary"
              />
            ))}
          </span>
          <span className="card grid size-11 place-items-center rounded-[23%] text-text [&_svg]:size-5">
            {icon}
          </span>
        </div>
        <h3 className="mt-4 text-[19px] leading-6 font-bold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-[19px] text-secondary">{text}</p>
        <div className="mt-4 overflow-hidden rounded-[14px] bg-well shadow-[inset_0_0_0_0.5px_var(--edge)]">
          <p className="flex h-8 items-center border-b border-separator px-3.5 font-mono text-[11px] text-secondary select-text">
            {file}
          </p>
          <pre className="max-h-[220px] overflow-auto p-3.5 font-mono text-[11.5px] leading-[17px] text-text/80 select-text">
            {code}
          </pre>
        </div>
        <div className="mt-5 flex justify-end gap-2">{actions}</div>
      </motion.div>
    </motion.div>
  );
}
