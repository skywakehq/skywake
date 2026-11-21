"use client";

import { ChevronRight } from "lucide-react";
import { FolderIcon } from "@skywake/ui/components/folder-icon";
import { FileIcon } from "@/features/files/file-icon";
import { asJSON, asText, useFetch } from "@/lib/fetch-text";
import { apiPath } from "@/lib/paths";
import { Note } from "./diff";

type Info = { name: string; kind: "file" | "folder" | "symlink"; size: number; target?: string };
type Listing = Info & { entries: Info[] };

/** The files of a branch as they were at one commit. */
export function FileBrowser({
  ns,
  branch,
  at,
  path,
  onOpen,
}: {
  ns: string;
  branch: string;
  at: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  const base = `branches/${encodeURIComponent(branch)}/files`;
  const query = `path=${encodeURIComponent(path)}&at=${at}`;
  const listing = useFetch<Listing>(apiPath(ns, `${base}?${query}`), asJSON);
  const isFile = listing.state === "done" && listing.value.kind === "file";
  const text = useFetch(isFile ? apiPath(ns, `${base}/content?${query}`) : null, asText);
  const parts = path ? path.split("/") : [];

  return (
    <div>
      <nav className="flex h-9 items-center gap-1 px-3 text-xs text-muted-foreground">
        <button onClick={() => onOpen("")} className="hover:text-fg">
          {branch}
        </button>
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-faint" />
            <button
              onClick={() => onOpen(parts.slice(0, i + 1).join("/"))}
              className="hover:text-fg"
            >
              {part}
            </button>
          </span>
        ))}
      </nav>
      {listing.state === "loading" && <Note>Loading…</Note>}
      {listing.state === "failed" && <Note>{listing.error}</Note>}
      {listing.state === "done" && listing.value.kind === "folder" && (
        <ul>
          {listing.value.entries.map((entry) => (
            <li key={entry.name}>
              <button
                onClick={() => onOpen(path ? `${path}/${entry.name}` : entry.name)}
                className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-hover"
              >
                {entry.kind === "folder" ? (
                  <FolderIcon className="h-4 w-auto" />
                ) : (
                  <FileIcon name={entry.name} className="size-4" />
                )}
                {entry.name}
                {entry.kind === "file" && (
                  <span className="ml-auto text-xs tabular-nums text-faint">
                    {size(entry.size)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!listing.value.entries.length && <Note>An empty folder.</Note>}
        </ul>
      )}
      {isFile &&
        text.state === "done" &&
        (text.value.includes("\0") ? (
          <Note>A binary file.</Note>
        ) : (
          <pre className="overflow-x-auto rounded-xl bg-background py-3 font-mono text-xs leading-[19px]">
            {text.value.split("\n").map((line, i) => (
              <div key={i} className="flex">
                <span className="w-10 shrink-0 select-none pr-3 text-right text-faint">
                  {i + 1}
                </span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))}
          </pre>
        ))}
    </div>
  );
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
