"use client";

import { useZero } from "@rocicorp/zero/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  FileUp,
  FolderInput,
  FolderPlus,
  FolderUp,
  GitBranch,
  History,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import {
  type DragEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@skywake/ui/components/alert-dialog";
import { mainOf, useFleet } from "@/features/fleet/fleet";
import { NamespacePage } from "@/features/namespaces/namespace-header";
import { ForkDialog, useForkDialog } from "@/features/branches/branch-actions";
import { Link, navigate } from "@/components/shell/router";
import { Ago, Button, Choice, Glide, cx } from "@/components/kit";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Prompt } from "@/components/menu";
import { bytes, kindOf } from "@/lib/file-kinds";
import { settled } from "@/lib/mutate";
import { nameInEnv } from "@/lib/names";
import { branchPath, nsPath } from "@/lib/paths";
import { mutators } from "@/zero/mutators";
import {
  type Change,
  type Entry,
  type Listing,
  commit,
  contentUrl,
  download,
  failure,
  join,
  listUrl,
  zipUrl,
} from "./api";
import { FileIcon } from "./file-icon";
import { MoveDialog } from "./move-dialog";
import { Preview } from "./preview";
import { upload } from "./uploads";

type Sort = { by: "name" | "size" | "modified"; up: boolean };

/** A filesystem's files on one branch, to browse and change like a drive. */
export function Files({ ns }: { ns: string }) {
  const params = useSearchParams();
  const fleet = useFleet({ ns });
  const zero = useZero();
  const { fork, openFork, closeFork } = useForkDialog();

  const main = mainOf(fleet.branches);
  const branchName = params.get("branch") ?? main?.name ?? "main";
  const branch = fleet.branches.find((b) => b.name === branchName);
  // A new filesystem has no branches. Its first change makes main.
  const fresh = !fleet.loading && !fleet.branches.length;
  const dir = params.get("path") ?? "";

  const go = useCallback(
    (to: { branch?: string; path?: string }) => {
      const next = new URLSearchParams();
      const name = to.branch ?? branchName;
      const path = to.path ?? dir;
      if (name !== main?.name) next.set("branch", name);
      if (path) next.set("path", path);
      const query = next.toString();
      navigate(`${nsPath(ns, "files")}${query ? `?${query}` : ""}`);
    },
    [ns, branchName, dir, main?.name],
  );

  const { listing, error, loading } = useListing(listUrl(ns, branchName, dir, branch?.head));
  const [view, setView] = useView();
  const [sort, setSort] = useState<Sort>({ by: "name", up: true });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [making, setMaking] = useState(false);
  const [history, setHistory] = useState(false);
  const [clash, setClash] = useState<{ picked: Picked[]; names: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // A new folder or branch starts with nothing chosen.
  const place = `${branchName}\n${dir}`;
  const [shownPlace, setShownPlace] = useState(place);
  if (shownPlace !== place) {
    setShownPlace(place);
    setSelected(new Set());
    setAnchor(null);
    setFilter("");
  }

  const entries = useMemo(() => {
    const all = listing?.kind === "folder" ? listing.entries : [];
    const shown = filter
      ? all.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
      : all;
    const key = (e: Entry) =>
      sort.by === "name" ? 0 : sort.by === "size" ? e.size : (e.modified ?? 0);
    return [...shown].sort((a, b) => {
      if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
      const order = key(a) - key(b) || a.name.localeCompare(b.name, undefined, { numeric: true });
      return sort.up ? order : -order;
    });
  }, [listing, filter, sort]);

  const chosen = entries.filter((e) => selected.has(e.name));
  const files = entries.filter((e) => e.kind === "file");

  /** The branch to write to: this one, or a new fork when it is protected. */
  const writable = useCallback(async () => {
    if (fresh) {
      await settled(zero.mutate(mutators.branch.fork({ ns, name: branchName })));
      return branchName;
    }
    if (!branch?.protected) return branchName;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const name = `edits/${stamp}`;
    await settled(zero.mutate(mutators.branch.fork({ ns, name, from: branchName })));
    go({ branch: name });
    toast(`${branchName} is protected`, {
      description: `Your changes are on ${name}. Merge it into ${branchName} when it is ready.`,
    });
    return name;
  }, [fresh, branch?.protected, branchName, zero, ns, go]);

  async function change(message: string, changes: Change[], done: string) {
    try {
      const target = await writable();
      await commit(ns, target, message, changes);
      toast.success(done);
      setSelected(new Set());
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  /** Upload, but first ask what to do when a name is already here. */
  function send(picked: Picked[]) {
    if (!picked.length) return;
    const here = new Set(listing?.kind === "folder" ? listing.entries.map((e) => e.name) : []);
    const names = [...new Set(picked.map((p) => top(p.path)))].filter((name) => here.has(name));
    if (names.length) setClash({ picked, names });
    else start(picked);
  }

  /** Give each clashing name a free one, like "report (1).pdf". */
  function keepBoth(picked: Picked[], names: string[]) {
    const taken = new Set(listing?.kind === "folder" ? listing.entries.map((e) => e.name) : []);
    const renamed = new Map<string, string>();
    for (const name of names) {
      const free = freeName(name, taken);
      taken.add(free);
      renamed.set(name, free);
    }
    return picked.map(({ file, path }) => {
      const [first, ...rest] = path.split("/");
      return { file, path: [renamed.get(first!) ?? first, ...rest].join("/") };
    });
  }

  async function start(picked: Picked[]) {
    try {
      const target = await writable();
      const placed = picked.map(({ file, path }) => ({ file, path: join(dir, path) }));
      upload(ns, target, placed, dir ? `/${dir}` : nameInEnv(ns));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  function open(entry: Entry) {
    if (entry.kind === "folder") go({ path: join(dir, entry.name) });
    else setPreviewing(entry.name);
  }

  function choose(event: MouseEvent, name: string) {
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setSelected(next);
      setAnchor(name);
    } else if (event.shiftKey && anchor) {
      const names = entries.map((e) => e.name);
      const [from, to] = [names.indexOf(anchor), names.indexOf(name)].sort((a, b) => a - b);
      setSelected(new Set(names.slice(from, to + 1)));
    } else {
      setSelected(new Set([name]));
      setAnchor(name);
    }
  }

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
    setAnchor(name);
  }

  function downloadEntries(list: Entry[]) {
    if (list.length === 1 && list[0]!.kind === "file")
      download(
        contentUrl(ns, branchName, join(dir, list[0]!.name), { at: branch?.head, download: true }),
      );
    else
      download(
        zipUrl(
          ns,
          branchName,
          list.map((e) => join(dir, e.name)),
          branch?.head,
        ),
      );
  }

  // Keys work like a desktop file manager, unless a field or dialog has them.
  const keys = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("input, textarea, [role=dialog], [role=alertdialog], [role=menu]") ||
      previewing
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key === "a") {
      event.preventDefault();
      setSelected(new Set(entries.map((e) => e.name)));
    } else if (event.key === "Escape") setSelected(new Set());
    else if ((event.key === "Delete" || event.key === "Backspace") && chosen.length)
      setDeleting(chosen.map((e) => e.name));
    else if (event.key === "Enter" && chosen.length === 1) open(chosen[0]!);
    else if (event.key === "F2" && chosen.length === 1) setRenaming(chosen[0]!.name);
  });
  useEffect(() => {
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  async function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    send(await dropped(event.dataTransfer));
  }

  const parts = dir ? dir.split("/") : [];
  const forkedFrom = !branch?.protected ? branch?.forkedFrom : undefined;

  return (
    <NamespacePage
      ns={ns}
      main={main?.name}
      head={main?.head}
      commits={fleet.commits.length}
      onFork={main ? () => openFork(main.name) : undefined}
    >
      <div
        className="relative grid gap-4"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <div className="flex flex-wrap items-center gap-2">
          <BranchMenu
            current={branchName}
            branches={fleet.branches}
            onPick={(name) => go({ branch: name, path: "" })}
          />
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-sm">
            <Crumb onClick={() => go({ path: "" })} current={!parts.length}>
              {nameInEnv(ns)}
            </Crumb>
            {parts.map((part, i) => (
              <span key={i} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight className="size-3.5 shrink-0 text-faint" />
                <Crumb
                  onClick={() => go({ path: parts.slice(0, i + 1).join("/") })}
                  current={i === parts.length - 1}
                >
                  {part}
                </Crumb>
              </span>
            ))}
          </nav>
          {chosen.length > 0 ? (
            // While something is chosen, its actions take the tools' place.
            <div className="flex items-center gap-1">
              <span className="pr-2 text-sm tabular-nums">{chosen.length} selected</span>
              <Button leadingIcon={Download} onClick={() => downloadEntries(chosen)}>
                Download
              </Button>
              {chosen.length === 1 && (
                <Button leadingIcon={Pencil} onClick={() => setRenaming(chosen[0]!.name)}>
                  Rename
                </Button>
              )}
              <Button
                leadingIcon={FolderInput}
                onClick={() => setMoving(chosen.map((e) => e.name))}
              >
                Move
              </Button>
              <Button leadingIcon={Trash2} onClick={() => setDeleting(chosen.map((e) => e.name))}>
                Delete
              </Button>
              <button
                aria-label="Clear the selection"
                title="Clear the selection"
                onClick={() => setSelected(new Set())}
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-hover"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <label className="flex h-7 w-40 items-center gap-1.5 rounded-md bg-muted/70 px-2 text-muted-foreground focus-within:bg-muted max-sm:hidden">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter"
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
                />
              </label>
              <Choice
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: "List", icon: List },
                  { value: "grid", label: "Grid", icon: LayoutGrid },
                ]}
              />
              <Button leadingIcon={FolderPlus} onClick={() => setMaking(true)}>
                New folder
              </Button>
            </>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="primary" leadingIcon={UploadIcon}>
                Upload
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                index={0}
                icon={FileUp}
                label="Files"
                onSelect={() => filesInput.current?.click()}
              />
              <MenuItem
                index={1}
                icon={FolderUp}
                label="Folder"
                onSelect={() => folderInput.current?.click()}
              />
            </MenuContent>
          </Menu>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              send([...(event.target.files ?? [])].map((file) => ({ file, path: file.name })));
              event.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...{ webkitdirectory: "" }}
            onChange={(event) => {
              send(
                [...(event.target.files ?? [])].map((file) => ({
                  file,
                  path: file.webkitRelativePath || file.name,
                })),
              );
              event.target.value = "";
            }}
          />
        </div>

        {branch?.protected && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Lock className="size-3.5" />
            {branchName} is protected. What you change goes to a new branch, to merge when it is
            ready.
          </p>
        )}
        {forkedFrom && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <GitBranch className="size-3.5" />
            Working on {branchName}, forked from {forkedFrom}.
            <Link
              href={branchPath(ns, branchName)}
              className="font-medium text-foreground hover:underline"
            >
              See changes and merge
            </Link>
          </p>
        )}

        <div
          className="-mx-3 min-h-80"
          onClick={(event) => event.target === event.currentTarget && setSelected(new Set())}
        >
          {fresh ? (
            <Blank title="This filesystem is empty.">
              Drop files here, upload them, or make a folder.
            </Blank>
          ) : error ? (
            <Blank title="This folder is not on this branch.">
              <button
                onClick={() => go({ path: "" })}
                className="font-medium text-foreground hover:underline"
              >
                Go to the top
              </button>
            </Blank>
          ) : !listing && loading ? (
            <div className="grid gap-px p-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
              ))}
            </div>
          ) : !entries.length ? (
            <Blank title={filter ? "Nothing matches." : "This folder is empty."}>
              {!filter && "Drop files here, or upload them."}
            </Blank>
          ) : view === "list" ? (
            <ListView
              entries={entries}
              selected={selected}
              sort={sort}
              onSort={(by) =>
                setSort(sort.by === by ? { by, up: !sort.up } : { by, up: by === "name" })
              }
              onChoose={choose}
              onToggle={toggle}
              onToggleAll={() =>
                setSelected(
                  chosen.length === entries.length
                    ? new Set()
                    : new Set(entries.map((e) => e.name)),
                )
              }
              onOpen={open}
              actions={(entry) => (
                <RowMenu
                  entry={entry}
                  onOpen={() => open(entry)}
                  onDownload={() => downloadEntries([entry])}
                  onRename={() => setRenaming(entry.name)}
                  onMove={() => setMoving([entry.name])}
                  onDelete={() => setDeleting([entry.name])}
                  onVersions={() => {
                    setHistory(true);
                    open(entry);
                  }}
                />
              )}
            />
          ) : (
            <GridView
              entries={entries}
              selected={selected}
              thumb={(entry) =>
                contentUrl(ns, branchName, join(dir, entry.name), { at: branch?.head })
              }
              onChoose={choose}
              onOpen={open}
            />
          )}
        </div>

        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
              }}
              className="absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-signal bg-signal/5"
            >
              <div className="pointer-events-none grid place-items-center gap-2 text-center">
                <UploadIcon className="size-6 text-signal" />
                <p className="text-sm font-medium">
                  Drop to upload to {dir ? `/${dir}` : nameInEnv(ns)}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Preview
        ns={ns}
        branch={branchName}
        head={branch?.head}
        dir={dir}
        files={files}
        name={previewing}
        onName={setPreviewing}
        versions={history}
        onVersions={setHistory}
        onClose={() => setPreviewing(null)}
        onRename={() => setRenaming(previewing)}
        onDelete={() => previewing && setDeleting([previewing])}
        onRestore={(path, at) =>
          change(
            `Restore ${path}`,
            [{ path, from: { path, at } }],
            `Restored ${path.split("/").pop()}`,
          )
        }
      />

      <Prompt
        open={making}
        onOpenChange={setMaking}
        title="New folder"
        label="Folder name"
        initial="Untitled folder"
        submit="Create"
        onSubmit={(name) =>
          change(
            `Create ${join(dir, name)}`,
            [{ path: join(dir, name), folder: true }],
            `Created ${name}`,
          )
        }
      />
      <Prompt
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={`Rename ${renaming ?? ""}`}
        label="New name"
        initial={renaming ?? ""}
        submit="Rename"
        onSubmit={async (name) => {
          if (!renaming || name === renaming) return;
          if (name.includes("/")) throw new Error("A name cannot hold /");
          const [from, to] = [join(dir, renaming), join(dir, name)];
          if (previewing === renaming) setPreviewing(name);
          await change(
            `Rename ${from} to ${to}`,
            [
              { path: to, from: { path: from } },
              { path: from, delete: true },
            ],
            `Renamed to ${name}`,
          );
        }}
      />
      <MoveDialog
        ns={ns}
        branch={branchName}
        head={branch?.head}
        names={moving}
        dir={dir}
        onClose={() => setMoving(null)}
        onMove={(to) => {
          const names = moving ?? [];
          const changes = names.flatMap((name): Change[] => [
            { path: join(to, name), from: { path: join(dir, name) } },
            { path: join(dir, name), delete: true },
          ]);
          setMoving(null);
          change(
            `Move ${names.length === 1 ? join(dir, names[0]!) : `${names.length} items`} to /${to}`,
            changes,
            `Moved to ${to ? `/${to}` : "the top"}`,
          );
        }}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.length === 1 ? deleting[0] : `${deleting?.length} items`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It stays in the history, so you can bring it back from an older version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const names = deleting ?? [];
                setDeleting(null);
                if (previewing && names.includes(previewing)) setPreviewing(null);
                change(
                  `Delete ${names.length === 1 ? join(dir, names[0]!) : `${names.length} items`}`,
                  names.map((name) => ({ path: join(dir, name), delete: true })),
                  names.length === 1 ? `Deleted ${names[0]}` : `Deleted ${names.length} items`,
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={clash !== null} onOpenChange={(open) => !open && setClash(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {clash?.names.length === 1
                ? `${clash.names[0]} is already here`
                : `${clash?.names.length} items are already here`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Replace makes the upload the newest version. The current one stays in its versions, so
              you can go back to it. Keep both gives the upload a new name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="secondary"
              onClick={() => clash && start(keepBoth(clash.picked, clash.names))}
            >
              Keep both
            </AlertDialogAction>
            <AlertDialogAction onClick={() => clash && start(clash.picked)}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fork && <ForkDialog ns={ns} from={fork.from} at={fork.at} open onOpenChange={closeFork} />}
    </NamespacePage>
  );
}

function Crumb({
  children,
  current,
  onClick,
}: {
  children: string;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "truncate rounded-md px-1.5 py-0.5 hover:bg-hover",
        current ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BranchMenu({
  current,
  branches,
  onPick,
}: {
  current: string;
  branches: { name: string; protected: boolean }[];
  onPick: (name: string) => void;
}) {
  const sorted = [...branches].sort(
    (a, b) => Number(b.protected) - Number(a.protected) || a.name.localeCompare(b.name),
  );
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button leadingIcon={GitBranch} className="max-w-56 font-mono">
          <span className="truncate">{current}</span>
        </Button>
      </MenuTrigger>
      <MenuContent
        align="start"
        checkedIndex={sorted.findIndex((b) => b.name === current)}
        className="max-h-80 overflow-y-auto"
      >
        {sorted.map((branch, index) => (
          <MenuItem
            key={branch.name}
            index={index}
            icon={branch.protected ? Lock : GitBranch}
            label={branch.name}
            checked={branch.name === current}
            onSelect={() => onPick(branch.name)}
          />
        ))}
      </MenuContent>
    </Menu>
  );
}

type Picked = { file: File; path: string };

const top = (path: string) => path.split("/")[0]!;

function freeName(name: string, taken: Set<string>) {
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 1; ; i++) {
    const next = `${base} (${i})${ext}`;
    if (!taken.has(next)) return next;
  }
}

function RowMenu({
  entry,
  onOpen,
  onDownload,
  onRename,
  onMove,
  onDelete,
  onVersions,
}: {
  entry: Entry;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onVersions: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          aria-label={`More for ${entry.name}`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem
          index={0}
          icon={entry.kind === "folder" ? ChevronRight : Eye}
          label={entry.kind === "folder" ? "Open" : "Preview"}
          onSelect={onOpen}
        />
        <MenuItem index={1} icon={Download} label="Download" onSelect={onDownload} />
        {entry.kind === "file" && (
          <MenuItem index={2} icon={History} label="Versions" onSelect={onVersions} />
        )}
        <MenuSeparator />
        <MenuItem index={3} icon={Pencil} label="Rename" onSelect={onRename} />
        <MenuItem index={4} icon={FolderInput} label="Move to…" onSelect={onMove} />
        <MenuSeparator />
        <MenuItem index={5} icon={Trash2} label="Delete" onSelect={onDelete} />
      </MenuContent>
    </Menu>
  );
}

function Check({
  on,
  partly,
  onClick,
  label,
}: {
  on: boolean;
  partly?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={partly ? "mixed" : on}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cx(
        "grid size-4 place-items-center border transition-colors",
        on || partly
          ? "border-foreground bg-foreground text-background"
          : "border-line-strong bg-background",
      )}
    >
      {on && (
        <svg
          viewBox="0 0 12 12"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2.5 6.2 5 8.5l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {partly && !on && <span className="h-0.5 w-2 bg-current" />}
    </button>
  );
}

const COLUMNS =
  "grid grid-cols-[28px_minmax(0,1fr)_96px_112px_36px] items-center gap-2 max-sm:grid-cols-[28px_minmax(0,1fr)_36px]";

function ListView({
  entries,
  selected,
  sort,
  onSort,
  onChoose,
  onToggle,
  onToggleAll,
  onOpen,
  actions,
}: {
  entries: Entry[];
  selected: Set<string>;
  sort: Sort;
  onSort: (by: Sort["by"]) => void;
  onChoose: (event: MouseEvent, name: string) => void;
  onToggle: (name: string) => void;
  onToggleAll: () => void;
  onOpen: (entry: Entry) => void;
  actions: (entry: Entry) => React.ReactNode;
}) {
  const count = entries.filter((e) => selected.has(e.name)).length;
  const Arrow = sort.up ? ArrowUp : ArrowDown;
  const head = (by: Sort["by"], label: string, className?: string) => (
    <button
      onClick={() => onSort(by)}
      className={cx(
        "flex items-center gap-1 hover:text-foreground",
        sort.by === by && "text-foreground",
        className,
      )}
    >
      {label}
      {sort.by === by && <Arrow className="size-3" />}
    </button>
  );
  return (
    <div>
      <div className={cx(COLUMNS, "h-10 border-b px-3 text-xs text-muted-foreground")}>
        <span className="grid place-items-center">
          <Check
            on={count > 0 && count === entries.length}
            partly={count > 0 && count < entries.length}
            onClick={onToggleAll}
            label="Select all"
          />
        </span>
        {head("name", "Name")}
        {head("size", "Size", "justify-end max-sm:hidden")}
        {head("modified", "Modified", "justify-end max-sm:hidden")}
        <span />
      </div>
      <Glide className="p-1">
        {entries.map((entry) => {
          const on = selected.has(entry.name);
          return (
            <div
              key={entry.name}
              data-glide
              onClick={(event) => onChoose(event, entry.name)}
              onDoubleClick={() => onOpen(entry)}
              className={cx(
                COLUMNS,
                "group h-10 cursor-default rounded-md px-2 text-sm select-none",
                on && "bg-selected",
              )}
            >
              <span
                className={cx(
                  "grid place-items-center",
                  !on && "opacity-0 group-hover:opacity-100",
                  selected.size > 0 && "opacity-100",
                )}
              >
                <Check
                  on={on}
                  onClick={() => onToggle(entry.name)}
                  label={`Select ${entry.name}`}
                />
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <FileIcon
                  name={entry.name}
                  folder={entry.kind === "folder"}
                  className="size-4 shrink-0"
                />
                <button
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                    event.stopPropagation();
                    onOpen(entry);
                  }}
                  className="truncate text-left hover:underline"
                >
                  {entry.name}
                </button>
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground max-sm:hidden">
                {entry.kind === "file" ? bytes(entry.size) : "—"}
              </span>
              <span className="flex justify-end max-sm:hidden">
                {entry.modified ? (
                  <Ago time={entry.modified} />
                ) : (
                  <span className="text-xs text-faint">—</span>
                )}
              </span>
              <span className="grid place-items-center">{actions(entry)}</span>
            </div>
          );
        })}
      </Glide>
    </div>
  );
}

function GridView({
  entries,
  selected,
  thumb,
  onChoose,
  onOpen,
}: {
  entries: Entry[];
  selected: Set<string>;
  thumb: (entry: Entry) => string;
  onChoose: (event: MouseEvent, name: string) => void;
  onOpen: (entry: Entry) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-3">
      {entries.map((entry) => {
        const on = selected.has(entry.name);
        const image =
          entry.kind === "file" && kindOf(entry.name) === "image" && entry.size < 25_000_000;
        return (
          <div
            key={entry.name}
            onClick={(event) => onChoose(event, entry.name)}
            onDoubleClick={() => onOpen(entry)}
            className={cx(
              "grid cursor-default gap-2 rounded-lg p-2 select-none transition-colors",
              on ? "bg-selected" : "hover:bg-hover",
            )}
          >
            <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-md bg-muted/50">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb(entry)} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <FileIcon name={entry.name} folder={entry.kind === "folder"} className="size-9" />
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 px-0.5">
              <FileIcon
                name={entry.name}
                folder={entry.kind === "folder"}
                className="size-3.5 shrink-0"
              />
              <span className="truncate text-sm">{entry.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Blank({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-80 place-items-center p-8 text-center">
      <div>
        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
          <UploadIcon className="size-5" />
        </div>
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** The listing at `url`. While a newer one loads for the same folder, the old one stays. */
function useListing(url: string) {
  const place = url.replace(/&at=[^&]*/, "");
  const [state, setState] = useState<{
    url: string;
    place: string;
    listing?: Listing;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(await failure(response));
        return (await response.json()) as Listing;
      })
      .then(
        (listing) => live && setState({ url, place, listing }),
        (error: Error) => live && setState({ url, place, error: error.message }),
      );
    return () => {
      live = false;
    };
  }, [url, place]);
  const same = state?.place === place;
  return {
    listing: same ? state.listing : undefined,
    error: state?.url === url ? state.error : undefined,
    loading: state?.url !== url,
  };
}

const VIEW_KEY = "skywake:files-view";
const viewListeners = new Set<() => void>();

function useView() {
  const view = useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    () => {
      try {
        return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
      } catch {
        return "list";
      }
    },
    () => "list" as const,
  );
  const set = (next: "list" | "grid") => {
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
    viewListeners.forEach((listener) => listener());
  };
  return [view, set] as const;
}

/** The files in a drop, with folders walked so each file keeps its place. */
async function dropped(data: DataTransfer) {
  const roots = [...data.items].map((item) => item.webkitGetAsEntry()).filter((e) => e !== null);
  // Without folder entries, take the plain files.
  if (!roots.length) return [...data.files].map((file) => ({ file, path: file.name }));
  const found: { file: File; path: string }[] = [];
  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      found.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }
  for (const root of roots) await walk(root, "");
  return found;
}
