"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "@/components/shell/router";
import { Button, Empty, Glide, Page, Rows } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { envOf, nameInEnv } from "@/lib/names";
import { indexApi, indexPath } from "@/lib/paths";
import { type IndexInfo, bytes, indexUrl, useApi } from "./api";
import { NewIndex } from "./new-index";

/** An environment's search indexes, one row each. */
export function Indexes({ env }: { env: string }) {
  const { loaded, reload } = useApi<IndexInfo[]>(indexApi());
  const [creating, setCreating] = useState(false);
  const shown = loaded.state === "done" ? loaded.value.filter((i) => envOf(i.name) === env) : [];

  return (
    <Page
      eyebrow={env}
      title="Indexes"
      description="Vectors and attributes, searched with filters. Each index has branches, like a filesystem."
      actions={
        <Button
          leadingIcon={Plus}
          variant="primary"
          size="default"
          onClick={() => setCreating(true)}
        >
          New index
        </Button>
      }
    >
      {loaded.state === "loading" ? (
        <Rows count={3} />
      ) : loaded.state === "failed" ? (
        <p className="text-sm text-destructive">{loaded.error}</p>
      ) : shown.length ? (
        <div className="-mx-4">
          <div className="flex h-9 items-center gap-4 border-b px-4 font-mono text-micro tracking-wide text-faint uppercase">
            <span className="flex-1">Name</span>
            <span className="w-28 max-md:hidden">Region</span>
            <span className="w-24 text-right">Rows</span>
            <span className="w-24 text-right max-sm:hidden">Size</span>
            <span className="w-72 max-lg:hidden">Vector columns</span>
          </div>
          <Glide className="divide-y divide-border/60">
            {shown.map((index) => (
              <IndexRow key={index.name} index={index} />
            ))}
          </Glide>
        </div>
      ) : (
        <div className="-mx-5">
          <Empty title={`No indexes in ${env}`} columns={["Index", "Documents", "Updated"]}>
            <p>
              An index holds documents with vectors and text. Make one, write to it, then query it.
            </p>
            <Button
              leadingIcon={Plus}
              variant="primary"
              className="mt-4"
              onClick={() => setCreating(true)}
            >
              New index
            </Button>
          </Empty>
        </div>
      )}
      <NewIndex env={env} open={creating} onOpenChange={setCreating} onCreated={reload} />
    </Page>
  );
}

function IndexRow({ index }: { index: IndexInfo }) {
  // The list has no counts; each row asks for its own.
  const { loaded } = useApi<IndexInfo>(indexUrl(index.name));
  const stats = loaded.state === "done" ? loaded.value.stats : undefined;
  const count = (value?: number) =>
    stats === undefined ? "…" : stats === null || value === undefined ? "—" : value;
  return (
    <Link href={indexPath(index.name)} data-glide className="flex h-12 items-center gap-4 px-4">
      <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
        {nameInEnv(index.name)}
      </span>
      <span
        title={index.region}
        className="w-28 truncate text-sm text-muted-foreground max-md:hidden"
      >
        {city(index.region)}
      </span>
      <span className="w-24 text-right text-sm tabular-nums">{count(stats?.rows)}</span>
      <span className="w-24 text-right text-sm text-muted-foreground tabular-nums max-sm:hidden">
        {stats ? bytes(stats.bytes) : count()}
      </span>
      <span className="w-72 truncate font-mono text-xs text-muted-foreground max-lg:hidden">
        {[
          ...index.schema.vectors.map((v) => `${v.name} ${v.dims} · ${v.metric}`),
          ...index.schema.attributes
            .filter((a) => a.type === "text")
            .map((a) => `${a.name} · text`),
        ].join(", ")}
      </span>
    </Link>
  );
}
