"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Choice, Panel, plural } from "@/components/kit";
import { type IndexInfo, type PinnedReplica, call, indexUrl } from "./api";
import { Select } from "./fields";

const REPLICAS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Pins the index to reserved replicas, and shows where they are. */
export function IndexPinning({ index, onChange }: { index: IndexInfo; onChange: () => void }) {
  const saved = index.pinned?.replicas ?? 0;
  const [replicas, setReplicas] = useState(saved);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await call("PATCH", indexUrl(index.name), { pinned: replicas ? { replicas } : null });
      toast.success(replicas ? `Pinned to ${plural(replicas, "replica")}` : "Unpinned");
      onChange();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Pinning">
      <div className="grid gap-3 px-4 pt-4">
        <p className="text-sm text-muted-foreground">
          A pinned index stays open and on the disks of reserved API servers, so its queries never
          wait on object storage. Each replica adds throughput, and is billed per GB-hour instead of
          per query.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Choice
            value={replicas ? "on" : "off"}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "Pinned" },
            ]}
            onChange={(value) => setReplicas(value === "on" ? saved || 1 : 0)}
          />
          {replicas > 0 && (
            <Select
              aria-label="Replicas"
              value={replicas}
              onChange={(event) => setReplicas(Number(event.target.value))}
            >
              {REPLICAS.map((n) => (
                <option key={n} value={n}>
                  {plural(n, "replica")}
                </option>
              ))}
            </Select>
          )}
          <Button variant="primary" disabled={busy || replicas === saved} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      {index.pinning && (
        <div className="mt-4 border-t">
          {index.pinning.replicas.length ? (
            index.pinning.replicas.map((replica) => (
              <Replica key={replica.server} replica={replica} />
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">No server holds it yet.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Replica({ replica }: { replica: PinnedReplica }) {
  return (
    <div className="flex h-10 items-center gap-4 border-b border-border/60 px-4 last:border-0">
      <span className="flex-1 truncate font-mono text-sm">{replica.server}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {replica.warm ? "warm" : "warming"} · {replica.in_flight} in flight
      </span>
    </div>
  );
}
