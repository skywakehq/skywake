"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "@/components/shell/router";
import { Button, Empty, Glide, IndexMark, Page, Rows } from "@/components/kit";
import { city } from "@/features/environments/regions";
import { namespaceName } from "@/lib/names";
import { indexPath, v2Api } from "@/lib/paths";
import { type IndexInfo, type IndexSummary, bytes, indexUrl, useApi, useEveryPage } from "./api";
import { NewIndex } from "./new-index";

/** An environment's search indexes, one row each. */
export function Indexes({ env }: { env: string }) {
  const { loaded, reload } = useEveryPage<IndexSummary>(v2Api(env, "indexes"));
  const [creating, setCreating] = useState(false);
  const shown = loaded.state === "done" ? loaded.value : [];

  return (
    <Page
      eyebrow={env}
      title="Indexes"
      description="Rows of fields and vectors, searched by meaning, keywords and filters. Each index has branches to try changes on before merging them."
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
          <div className="flex h-10 items-center gap-4 border-b px-4 text-xs text-muted-foreground">
            <span className="flex-1">Name</span>
            <span className="w-28 max-md:hidden">Region</span>
            <span className="w-24 text-right">Rows</span>
            <span className="w-24 text-right max-sm:hidden">Size</span>
            <span className="w-72 max-lg:hidden">Vector fields</span>
          </div>
          <Glide className="divide-y divide-border/60">
            {shown.map((index) => (
              <IndexRow key={index.name} env={env} index={index} />
            ))}
          </Glide>
        </div>
      ) : (
        <div className="-mx-5">
          <Empty title={`No indexes in ${env}`} columns={["Index", "Rows", "Updated"]}>
            <p>
              An index holds rows of fields, vectors and text. Make one, write to it, then query it.
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

function IndexRow({ env, index }: { env: string; index: IndexSummary }) {
  const full = namespaceName(env, index.name);
  const { loaded } = useApi<IndexInfo>(indexUrl(full));
  const info = loaded.state === "done" ? loaded.value : undefined;
  const stats = info?.stats;
  const count = (value?: number) =>
    stats === undefined ? "…" : stats === null || value === undefined ? "—" : value;
  return (
    <Link href={indexPath(full)} data-glide className="flex h-12 items-center gap-4 px-4">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <IndexMark name={full} />
        <span className="truncate text-sm font-medium">{index.name}</span>
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
      <span className="w-72 truncate text-xs text-muted-foreground max-lg:hidden">
        {info &&
          [
            ...info.schema.vectors.map((v) => `${v.name} ${v.dims} · ${v.metric}`),
            ...info.schema.attributes
              .filter((a) => a.type === "text")
              .map((a) => `${a.name} · text`),
          ].join(", ")}
      </span>
    </Link>
  );
}
