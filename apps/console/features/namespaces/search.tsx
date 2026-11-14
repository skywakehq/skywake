"use client";

import { Link2, Search as SearchIcon, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "@/components/shell/router";
import { Ago, Button, Empty, Hash, Panel, Rows, cx } from "@/components/kit";
import { mainOf, useFleet } from "@/features/fleet/fleet";
import { call } from "@/features/indexes/api";
import { Label, TextArea, TextField } from "@/features/indexes/fields";
import { apiPath, indexPath } from "@/lib/paths";
import { NamespacePage } from "./namespace-header";

type LinkedBranch = {
  branch: string;
  synced: string | null;
  behind: boolean;
  syncedAt: string | null;
  error: string | null;
};

type IndexLink = {
  namespace: string;
  index: string;
  include: string[];
  exclude: string[];
  maxBytes: number;
  created: string;
  branches: LinkedBranch[];
};

/** How often the page reads the link again while a branch is behind. */
const BEHIND_POLL_MS = 5_000;

const lines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Reads the namespace's link; null when it has none. `reload` reads it again. */
function useIndexLink(ns: string) {
  const [state, setState] = useState<{ link: IndexLink | null; loading: boolean; error?: string }>(
    { link: null, loading: true },
  );
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    fetch(apiPath(ns, "index"))
      .then(async (response) => {
        if (response.status === 404) return null;
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? response.statusText);
        return body as IndexLink;
      })
      .then(
        (link) => live && setState({ link, loading: false }),
        (error: Error) => live && setState({ link: null, loading: false, error: error.message }),
      );
    return () => {
      live = false;
    };
  }, [ns, version]);

  const behind = state.link?.branches.some((branch) => branch.behind) ?? false;
  useEffect(() => {
    if (!behind) return;
    const timer = setInterval(reload, BEHIND_POLL_MS);
    return () => clearInterval(timer);
  }, [behind, reload]);

  return { ...state, reload };
}

/**
 * Search over the filesystem's files: link an index and Skywake keeps it in
 * step with `main` and with every branch forked with its index.
 */
export function NamespaceSearch({ ns }: { ns: string }) {
  const fleet = useFleet({ ns });
  const main = mainOf(fleet.branches);
  const { link, loading, error, reload } = useIndexLink(ns);

  return (
    <NamespacePage ns={ns} main={main?.name} head={main?.head} commits={fleet.commits.length}>
      {loading ? (
        <Rows count={4} />
      ) : error ? (
        <p className="text-sm text-red">{error}</p>
      ) : link ? (
        <Linked ns={ns} link={link} onChange={reload} />
      ) : (
        <LinkForm ns={ns} onLinked={reload} />
      )}
    </NamespacePage>
  );
}

function LinkForm({ ns, onLinked }: { ns: string; onLinked: () => void }) {
  const [index, setIndex] = useState(`${ns}-files`);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("node_modules/**\n**/*.lock");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await call("PUT", apiPath(ns, "index"), {
        index,
        include: lines(include),
        exclude: lines(exclude),
      });
      toast.success("Linked", { description: `${index} now follows main.` });
      onLinked();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Search these files">
      <Empty title="Nothing is indexed yet" columns={["File", "Branch"]}>
        Link an index and every commit to <span className="font-mono">main</span> is searchable
        within seconds; saves follow about 30 seconds later. Branches forked with their index get
        their own.
      </Empty>
      <div className="grid max-w-xl gap-4 px-5 pb-6">
        <label className="grid gap-1.5">
          <Label>Index</Label>
          <TextField
            value={index}
            onChange={(e) => setIndex(e.target.value)}
            className="font-mono"
            aria-label="Index name"
          />
          <span className="text-xs text-muted-foreground">
            Made with <span className="font-mono">path</span> and{" "}
            <span className="font-mono">text</span> attributes when it does not exist.
          </span>
        </label>
        <label className="grid gap-1.5">
          <Label>Include</Label>
          <TextArea
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            placeholder={"src/**\ndocs/**"}
            className="min-h-16"
            aria-label="Paths to include"
          />
          <span className="text-xs text-muted-foreground">One glob a line. Every file when empty.</span>
        </label>
        <label className="grid gap-1.5">
          <Label>Exclude</Label>
          <TextArea
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            className="min-h-16"
            aria-label="Paths to exclude"
          />
        </label>
        <Button
          variant="primary"
          size="default"
          leadingIcon={Link2}
          className="w-fit"
          disabled={busy || !index.trim()}
          onClick={save}
        >
          Link index
        </Button>
      </div>
    </Panel>
  );
}

function Linked({ ns, link, onChange }: { ns: string; link: IndexLink; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    try {
      await call("DELETE", apiPath(ns, "index"));
      toast.success("Unlinked", { description: `${link.index} and its documents stay.` });
      onChange();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <SearchIcon className="size-3.5 text-muted-foreground" />
            <Link href={indexPath(link.index, "query")} className="font-mono hover:underline">
              {link.index}
            </Link>
          </span>
        }
        action={
          <Button leadingIcon={Unlink} disabled={busy} onClick={unlink}>
            Unlink
          </Button>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-4 py-4 text-sm">
          <dt className="text-muted-foreground">Include</dt>
          <dd className="font-mono">{link.include.length ? link.include.join("  ") : "every file"}</dd>
          <dt className="text-muted-foreground">Exclude</dt>
          <dd className="font-mono">{link.exclude.length ? link.exclude.join("  ") : "nothing"}</dd>
          <dt className="text-muted-foreground">Largest file</dt>
          <dd className="tabular-nums">{Math.round(link.maxBytes / 1024)} KB</dd>
        </dl>
      </Panel>
      <Panel title="Branches" count={link.branches.length}>
        <div className="divide-y divide-border/60">
          {link.branches.map((branch) => (
            <div key={branch.branch} className="flex h-11 items-center gap-4 px-4 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono">{branch.branch}</span>
              {branch.error ? (
                <span className="truncate text-red" title={branch.error}>
                  {branch.error}
                </span>
              ) : (
                <span
                  className={cx(
                    "text-xs",
                    branch.behind ? "text-muted-foreground" : "text-green",
                  )}
                >
                  {branch.behind ? "catching up" : "up to date"}
                </span>
              )}
              <Hash value={branch.synced} />
              <span className="w-24 text-right text-xs text-muted-foreground">
                {branch.syncedAt ? <Ago time={Date.parse(branch.syncedAt)} /> : "not yet"}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
