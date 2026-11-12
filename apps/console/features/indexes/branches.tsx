"use client";

import { GitFork, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { Ago, Button, Glide, Panel, Rows } from "@/components/kit";
import { Prompt } from "@/components/menu";
import { navigate } from "@/components/shell/router";
import { indexApi, indexPath } from "@/lib/paths";
import type { Loaded } from "@/lib/fetch-text";
import { type IndexBranch, branchUrl, call } from "./api";

/** The index's branches: fork one, open one in the query tab, delete one. */
export function Branches({
  index,
  branches,
  onPick,
}: {
  index: string;
  branches: { loaded: Loaded<IndexBranch[]>; reload: () => void };
  onPick: (branch: string) => void;
}) {
  const [forking, setForking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { loaded, reload } = branches;

  async function remove(name: string) {
    try {
      await call("DELETE", branchUrl(index, name));
      toast.success(`Deleted ${name}`);
      reload();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <>
      <Panel title="Branches" count={loaded.state === "done" ? loaded.value.length : undefined}>
        {loaded.state === "loading" ? (
          <Rows count={2} />
        ) : loaded.state === "failed" ? (
          <p className="px-4 py-3 text-sm text-destructive">{loaded.error}</p>
        ) : (
          <Glide className="divide-y divide-border/60">
            {loaded.value.map((branch) => (
              <div key={branch.name} data-glide className="group flex h-12 items-center gap-4 px-4">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-mono text-sm"
                  onClick={() => {
                    onPick(branch.name);
                    navigate(indexPath(index, "query"));
                  }}
                >
                  {branch.name}
                </button>
                <span className="text-xs text-faint max-sm:hidden">
                  {branch.forked_from ? `from ${branch.forked_from}` : "first branch"}
                </span>
                <Ago time={Date.parse(branch.created)} className="w-8 text-right" />
                <Button leadingIcon={GitFork} onClick={() => setForking(branch.name)}>
                  Fork
                </Button>
                <Button
                  aria-label={`Delete ${branch.name}`}
                  leadingIcon={Trash2}
                  disabled={branch.name === "main"}
                  onClick={() => setDeleting(branch.name)}
                />
              </div>
            ))}
          </Glide>
        )}
      </Panel>

      <Prompt
        open={forking !== null}
        onOpenChange={(open) => !open && setForking(null)}
        title={`Fork ${forking ?? ""}`}
        description="A new branch at the same documents. Nothing is copied; each sees only its own writes."
        label="Branch name"
        initial={`${forking ?? "main"}-try`}
        submit="Fork"
        onSubmit={async (name) => {
          await call("POST", indexApi(index, "branches"), { name, from: forking });
          toast.success(`Forked ${name}`);
          reload();
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete {deleting}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its writes leave with it. Other branches keep theirs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && remove(deleting)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
