"use client";

import { ChevronRight, CornerLeftUp } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { asJSON, useFetch } from "@/lib/fetch-text";
import { Button } from "@/components/kit";
import { type Listing, join, listUrl } from "./api";
import { FileIcon } from "./file-icon";

/** Picks the folder to move `names` into, by walking the folders of the branch. */
export function MoveDialog({
  ns,
  branch,
  head,
  names,
  dir,
  onClose,
  onMove,
}: {
  ns: string;
  branch: string;
  head?: string | null;
  names: string[] | null;
  dir: string;
  onClose: () => void;
  onMove: (to: string) => void;
}) {
  return (
    <Dialog open={names !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]" showCloseButton={false}>
        {names && (
          <Picker
            key={names.join("\n")}
            ns={ns}
            branch={branch}
            head={head}
            names={names}
            dir={dir}
            onMove={onMove}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  ns,
  branch,
  head,
  names,
  dir,
  onMove,
}: {
  ns: string;
  branch: string;
  head?: string | null;
  names: string[];
  dir: string;
  onMove: (to: string) => void;
}) {
  const [at, setAt] = useState(dir);
  const listing = useFetch<Listing>(listUrl(ns, branch, at, head), asJSON);
  const moving = new Set(names.map((name) => join(dir, name)));
  // A folder cannot go inside itself.
  const inside = [...moving].some((path) => at === path || at.startsWith(`${path}/`));
  const folders =
    listing.state === "done" ? listing.value.entries.filter((e) => e.kind === "folder") : [];
  const parts = at ? at.split("/") : [];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">
          Move {names.length === 1 ? names[0] : `${names.length} items`}
        </DialogTitle>
        <DialogDescription className="text-sm">Choose a folder.</DialogDescription>
      </DialogHeader>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex h-9 items-center gap-1 border-b px-2 text-sm">
          <button
            disabled={!parts.length}
            onClick={() => setAt(parts.slice(0, -1).join("/"))}
            className="grid size-6 place-items-center text-muted-foreground hover:bg-hover disabled:opacity-40"
            aria-label="Up one folder"
          >
            <CornerLeftUp className="size-3.5" />
          </button>
          <span className="truncate text-muted-foreground">/{at}</span>
        </div>
        <ul className="h-64 overflow-y-auto p-1">
          {listing.state === "loading" && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</li>
          )}
          {listing.state === "done" && !folders.length && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No folders here.</li>
          )}
          {folders.map((folder) => {
            const path = join(at, folder.name);
            return (
              <li key={folder.name}>
                <button
                  disabled={moving.has(path)}
                  onClick={() => setAt(path)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-hover disabled:opacity-40"
                >
                  <FileIcon name={folder.name} folder className="size-4" />
                  <span className="flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="size-3.5 text-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button size="default">Cancel</Button>
        </DialogClose>
        <Button
          size="default"
          variant="primary"
          disabled={inside || at === dir}
          onClick={() => onMove(at)}
        >
          Move here
        </Button>
      </DialogFooter>
    </>
  );
}
