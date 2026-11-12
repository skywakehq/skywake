"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { Tooltip } from "@skywake/ui/components/tooltip";
import { asJSON, asText, useFetch } from "@/lib/fetch-text";
import { bytes, kindOf } from "@/lib/file-kinds";
import { Ago, Button, Hash, cx } from "@/components/kit";
import { type Entry, type Version, contentUrl, download, historyUrl, join } from "./api";
import { FileIcon } from "./file-icon";

const TEXT_LIMIT = 1024 * 1024;

// pdf.js needs the browser, so it is never rendered on the server.
const PdfView = dynamic(() => import("./pdf-view"), { ssr: false });

/**
 * A file in the design system's dialog, with its versions beside it. Arrows
 * step through the folder. `name` is null while it is closed.
 */
export function Preview({
  ns,
  branch,
  head,
  dir,
  files,
  name,
  onName,
  versions,
  onVersions,
  onClose,
  onRename,
  onDelete,
  onRestore,
}: {
  ns: string;
  branch: string;
  head?: string | null;
  dir: string;
  files: Entry[];
  name: string | null;
  onName: (name: string) => void;
  versions: boolean;
  onVersions: (open: boolean) => void;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRestore: (path: string, at: string) => void;
}) {
  const [at, setAt] = useState<string | null>(null);
  // The last file shown stays while the dialog closes.
  const [shown, setShown] = useState(name ?? "");
  if (name !== null && name !== shown) {
    setShown(name);
    setAt(null);
  }
  const index = files.findIndex((f) => f.name === shown);
  const entry = files[index];
  const path = join(dir, shown);
  const url = contentUrl(ns, branch, path, { at: at ?? head });
  const save = () => download(contentUrl(ns, branch, path, { at: at ?? head, download: true }));

  function step(by: number) {
    const next = files[index + by];
    if (next) onName(next.name);
  }

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        // Focus the dialog, not its first button, so no tooltip pops up on open.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest("input, textarea")) return;
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
        className="flex h-[calc(100dvh-2rem)] max-w-[min(1400px,calc(100vw-2rem))] flex-col overflow-hidden p-0"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <FileIcon name={shown} className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{shown}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {at ? (
                <>
                  An older version · <Hash value={at} className="text-xs" />
                </>
              ) : (
                `${entry ? bytes(entry.size) : ""} · ${branch}`
              )}
            </DialogDescription>
          </div>
          {at && (
            <Button
              variant="primary"
              leadingIcon={RotateCcw}
              onClick={() => {
                onRestore(path, at);
                setAt(null);
              }}
            >
              Restore this version
            </Button>
          )}
          <Icon label="Download" icon={Download} onClick={save} />
          <Icon label="Rename" icon={Pencil} onClick={onRename} />
          <Icon label="Delete" icon={Trash2} onClick={onDelete} />
          <Button
            variant="plain"
            leadingIcon={History}
            aria-pressed={versions}
            onClick={() => onVersions(!versions)}
            className={cx(versions && "bg-selected text-foreground")}
          >
            Versions
          </Button>
          <DialogClose asChild>
            <Button variant="plain" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="rounded-lg relative grid min-w-0 flex-1 place-items-center bg-muted/30 p-6">
            {shown && (
              <Body key={url} url={url} name={shown} size={entry?.size ?? 0} onDownload={save} />
            )}
            {index > 0 && (
              <Step side="left" onClick={() => step(-1)}>
                <ChevronLeft />
              </Step>
            )}
            {index >= 0 && index < files.length - 1 && (
              <Step side="right" onClick={() => step(1)}>
                <ChevronRight />
              </Step>
            )}
          </div>
          {versions && shown && (
            <Versions
              key={`${path}\n${head}`}
              url={historyUrl(ns, branch, path)}
              current={at}
              onPick={(hash, latest) => setAt(latest ? null : hash)}
              onDownload={(hash) =>
                download(contentUrl(ns, branch, path, { at: hash, download: true }))
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Body({
  url,
  name,
  size,
  onDownload,
}: {
  url: string;
  name: string;
  size: number;
  onDownload: () => void;
}) {
  const kind = kindOf(name);
  const [failed, setFailed] = useState(false);
  if (kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="max-h-full max-w-full rounded-md object-contain" />;
  if (kind === "video")
    return <video src={url} controls autoPlay className="max-h-full max-w-full rounded-md" />;
  if (kind === "audio") return <audio src={url} controls autoPlay className="w-full max-w-md" />;
  if (kind === "pdf")
    return failed ? (
      <None onDownload={onDownload} />
    ) : (
      <PdfView url={url} onFail={() => setFailed(true)} />
    );
  if (kind === "text" || (kind === "other" && size <= TEXT_LIMIT))
    return <Text url={url} size={size} onDownload={onDownload} />;
  return <None onDownload={onDownload} />;
}

function Text({ url, size, onDownload }: { url: string; size: number; onDownload: () => void }) {
  const text = useFetch(`${url}&offset=0&length=${TEXT_LIMIT}`, asText);
  if (text.state === "loading") return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (text.state === "failed") return <p className="text-sm text-red">{text.error}</p>;
  if (text.value.includes("\0")) return <None onDownload={onDownload} />;
  return (
    <div className="size-full max-w-5xl overflow-auto rounded-lg bg-card">
      <pre className="p-5 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words">
        {text.value}
      </pre>
      {size > TEXT_LIMIT && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          Showing the first {bytes(TEXT_LIMIT)}.{" "}
          <button onClick={onDownload} className="font-medium text-foreground hover:underline">
            Download the rest
          </button>
        </p>
      )}
    </div>
  );
}

function None({ onDownload }: { onDownload: () => void }) {
  return (
    <div className="grid place-items-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">No preview for this kind of file.</p>
      <Button variant="primary" leadingIcon={Download} onClick={onDownload}>
        Download
      </Button>
    </div>
  );
}

function Versions({
  url,
  current,
  onPick,
  onDownload,
}: {
  url: string;
  current: string | null;
  onPick: (hash: string, latest: boolean) => void;
  onDownload: (hash: string) => void;
}) {
  const versions = useFetch<Version[]>(url, asJSON);
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card max-sm:hidden">
      <h2 className="flex h-11 shrink-0 items-center border-b px-4 text-sm font-medium">
        Versions
      </h2>
      <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {versions.state === "loading" && (
          <li className="px-2.5 py-2 text-sm text-muted-foreground">Loading…</li>
        )}
        {versions.state === "failed" && (
          <li className="px-2.5 py-2 text-sm text-red">{versions.error}</li>
        )}
        {versions.state === "done" &&
          versions.value.map((version, i) => {
            const latest = i === 0;
            const on = latest ? current === null : current === version.hash;
            const gone = version.size == null;
            return (
              <li key={version.hash}>
                <div
                  className={cx(
                    "group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    on ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  <button
                    disabled={gone}
                    onClick={() => onPick(version.hash, latest)}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {latest ? (
                          "Current"
                        ) : (
                          <Ago time={version.time * 1000} className="text-sm text-foreground" />
                        )}
                      </span>
                      {latest && <Ago time={version.time * 1000} />}
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {gone ? "Deleted" : bytes(version.size ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {version.message}
                      {version.session ? ` · ${version.session}` : ""}
                    </div>
                  </button>
                  {!gone && (
                    <button
                      title="Download this version"
                      onClick={() => onDownload(version.hash)}
                      className="grid size-6 shrink-0 place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                    >
                      <Download className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
      </ol>
    </aside>
  );
}

function Icon({
  label,
  icon: Glyph,
  onClick,
}: {
  label: string;
  icon: typeof Download;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <Button variant="plain" size="icon-sm" aria-label={label} onClick={onClick}>
        <Glyph />
      </Button>
    </Tooltip>
  );
}

function Step({
  side,
  onClick,
  children,
}: {
  side: "left" | "right";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={side === "left" ? "Previous file" : "Next file"}
      className={cx(
        "absolute top-1/2 -translate-y-1/2 bg-card",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      {children}
    </Button>
  );
}
