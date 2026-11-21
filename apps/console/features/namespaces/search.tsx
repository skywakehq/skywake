"use client";

import { PowerOff, Search as SearchIcon, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ago, Button, Choice, Hash, Panel, Rows, cx, plural } from "@/components/kit";
import { mainOf, useFleet } from "@/features/fleet/fleet";
import { call, useApi } from "@/lib/api";
import { Label, TextArea, TextField } from "@/components/fields";
import { apiPath } from "@/lib/paths";
import { diskApi, v2 } from "@/lib/v2";
import { searchChanged } from "./disk-facts";
import { withBase } from "@/lib/zone";
import { NamespacePage } from "./namespace-header";
import { SearchBox } from "./search-box";

type Skipped = { path: string; reason: string };

type LinkedBranch = {
  branch: string;
  synced: string | null;
  behind: boolean;
  syncedAt: string | null;
  error: string | null;
  files: number | null;
  chunks: number | null;
  skipped: Skipped[];
};

type IndexLink = {
  namespace: string;
  index: string;
  include: string[];
  exclude: string[];
  maxBytes: number;
  embed: { model: string; dims: number; images: boolean } | null;
  made: boolean;
  created: string;
  branches: LinkedBranch[];
};

type Defaults = { embed: { model: string; images: boolean } | null };

type Mode = "meaning" | "words";

const MODES: { value: Mode; label: string }[] = [
  { value: "meaning", label: "Meaning and words" },
  { value: "words", label: "Words only" },
];

function useDefaults() {
  const { loaded } = useApi<Defaults>(withBase("/api/skywake/index-links/defaults"));
  return loaded.state === "done" ? loaded.value.embed : null;
}

const sizeOf = (bytes: number) =>
  bytes >= 1 << 20 ? `${Math.round(bytes / (1 << 20))} MB` : `${Math.round(bytes / 1024)} KB`;

const BEHIND_POLL_MS = 5_000;

const lines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);

function useIndexLink(ns: string) {
  const [state, setState] = useState<{ link: IndexLink | null; loading: boolean; error?: string }>({
    link: null,
    loading: true,
  });
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
        <SearchOn ns={ns} link={link} onChange={reload} />
      ) : (
        <TurnOn ns={ns} onDone={reload} />
      )}
    </NamespacePage>
  );
}

function TurnOn({ ns, onDone }: { ns: string; onDone: () => void }) {
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("node_modules/**\n**/*.lock");
  const [mode, setMode] = useState<Mode>("meaning");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const fallback = useDefaults();
  const needsModel = mode === "meaning" && !fallback && !model.trim();

  async function save() {
    setBusy(true);
    try {
      await call("PUT", apiPath(ns, "index"), {
        index: `${ns}.files`,
        include: lines(include),
        exclude: lines(exclude),
        embed: mode === "words" ? false : model.trim() ? { model: model.trim() } : undefined,
      });
      toast.success("Search is on", { description: "Files on main are searchable in seconds." });
      searchChanged(ns);
      onDone();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel grid max-w-2xl gap-6 p-8">
      <div>
        <p className="text-lg font-medium tracking-[-0.015em]">Search is off</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Turn it on and every file on <span className="font-mono">main</span> is searchable seconds
          after it is saved.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label>Search by</Label>
        <Choice value={mode} options={MODES} onChange={setMode} />
        {mode === "meaning" && (
          <TextField
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={fallback?.model ?? "Embedding model, such as voyage/voyage-multimodal-3.5"}
            className="mt-1 font-mono"
            aria-label="Embedding model"
          />
        )}
      </div>
      <details className="group">
        <summary className="w-fit cursor-pointer list-none text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Choose which files
        </summary>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5">
            <Label>Include</Label>
            <TextArea
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              placeholder={"src/**\ndocs/**"}
              className="min-h-16"
              aria-label="Paths to include"
            />
            <span className="text-xs text-muted-foreground">
              One glob a line. Every file when empty.
            </span>
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
        </div>
      </details>
      <Button
        variant="primary"
        size="default"
        leadingIcon={SearchIcon}
        className="w-fit"
        disabled={busy || needsModel}
        onClick={save}
      >
        Turn on search
      </Button>
    </div>
  );
}

function SearchOn({ ns, link, onChange }: { ns: string; link: IndexLink; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const fallback = useDefaults();

  async function upgrade() {
    setBusy(true);
    try {
      await call("PUT", apiPath(ns, "index"), {
        index: link.index,
        include: link.include,
        exclude: link.exclude,
        maxBytes: link.maxBytes,
        embed: {},
      });
      toast.success("Rebuilding", { description: "Search finds files by meaning too." });
      onChange();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const [env, path] = diskApi(ns);
      await v2(env, "PATCH", path, { search: false });
      toast.success("Search is off", { description: "The files stay; only the search goes." });
      searchChanged(ns);
      onChange();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10">
      <SearchBox ns={ns} branches={link.branches.map((branch) => branch.branch)} />
      <Panel
        title="Settings"
        action={
          <Button leadingIcon={PowerOff} disabled={busy} onClick={turnOff}>
            Turn off search
          </Button>
        }
      >
        <dl className="panel mx-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 p-5 text-sm">
          <dt className="text-muted-foreground">Include</dt>
          <dd className="font-mono">
            {link.include.length ? link.include.join("  ") : "every file"}
          </dd>
          <dt className="text-muted-foreground">Exclude</dt>
          <dd className="font-mono">{link.exclude.length ? link.exclude.join("  ") : "nothing"}</dd>
          <dt className="text-muted-foreground">Largest file</dt>
          <dd className="tabular-nums">{sizeOf(link.maxBytes)}</dd>
          <dt className="text-muted-foreground">Search by</dt>
          <dd className="flex flex-wrap items-center gap-3">
            {link.embed ? (
              <span>
                Meaning and words · <span className="font-mono">{link.embed.model}</span>
                {link.embed.images && " · images too"}
              </span>
            ) : (
              <span>Words only</span>
            )}
            {!link.embed && link.made && fallback && (
              <Button leadingIcon={Sparkles} disabled={busy} onClick={upgrade}>
                Add search by meaning
              </Button>
            )}
          </dd>
        </dl>
      </Panel>
      <Panel title="Branches" count={link.branches.length}>
        <div>
          {link.branches.map((branch) => (
            <BranchRow key={branch.branch} branch={branch} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function BranchRow({ branch }: { branch: LinkedBranch }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex h-11 items-center gap-4 px-4 text-sm">
        <span className="min-w-0 flex-1 truncate font-mono">{branch.branch}</span>
        {branch.files !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {plural(branch.files, "file")}
            {branch.chunks !== null && branch.chunks !== branch.files
              ? ` · ${plural(branch.chunks, "passage")}`
              : ""}
          </span>
        )}
        {branch.skipped.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {branch.skipped.length} skipped
          </button>
        )}
        {branch.error ? (
          <span className="truncate text-red" title={branch.error}>
            {branch.error}
          </span>
        ) : (
          <span className={cx("text-xs", branch.behind ? "text-muted-foreground" : "text-green")}>
            {branch.behind ? "catching up" : "up to date"}
          </span>
        )}
        <Hash value={branch.synced} />
        <span className="w-24 text-right text-xs text-muted-foreground">
          {branch.syncedAt ? <Ago time={Date.parse(branch.syncedAt)} /> : "not yet"}
        </span>
      </div>
      {open && (
        <ul className="grid gap-1 px-4 pb-3 text-xs">
          {branch.skipped.map((skip) => (
            <li key={skip.path} className="flex gap-3">
              <span className="min-w-0 truncate font-mono">{skip.path}</span>
              <span className="text-muted-foreground">{skip.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
