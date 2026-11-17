"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Panel } from "@/components/kit";
import { navigate } from "@/components/shell/router";
import { envOf, nameInEnv } from "@/lib/names";
import { envPath } from "@/lib/paths";
import { type IndexInfo, call, indexUrl } from "./api";
import { TextField } from "./fields";
import { IndexPinning } from "./pinning";

/** Pinning the index, and deleting it once its name is typed. */
export function IndexSettings({ index, onChange }: { index: IndexInfo; onChange: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = nameInEnv(index.name);

  async function remove() {
    setBusy(true);
    try {
      await call("DELETE", indexUrl(index.name));
      toast.success(`Deleted ${name}`);
      navigate(envPath(envOf(index.name), "indexes"));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10">
      <IndexPinning index={index} onChange={onChange} />
      <Panel title="Delete this index">
        <div className="grid gap-3 px-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Every branch and all its rows are deleted. This can&apos;t be undone. Type{" "}
            <span className="text-foreground">{name}</span> to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TextField
              aria-label="Index name"
              placeholder={name}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-72 max-sm:w-full"
            />
            <Button
              variant="danger"
              size="default"
              leadingIcon={Trash2}
              disabled={busy || typed !== name}
              onClick={remove}
            >
              Delete index
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
