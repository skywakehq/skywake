"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RotateCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { cn } from "@skywake/ui/lib/utils";
import { Button, Checkbox, Empty, Panel, Rows, plural } from "@/components/kit";
import { nameInEnv } from "@/lib/names";
import {
  type AttributeValue,
  type DocId,
  type Document,
  type DocumentPage,
  type IndexInfo,
  branchUrl,
  call,
  useApi,
} from "./api";
import { Select, TextArea, TextField } from "./fields";

const SIZES = [25, 50, 100];

// A key that keeps the number id 1 apart from the string id "1".
const keyOf = (id: DocId) => JSON.stringify(id);

/** The rows of a branch in pages, a lookup by id, a detail panel, writes and deletes. */
export function IndexRows({ index, branch }: { index: IndexInfo; branch: string }) {
  // Another branch starts again from the first page, with nothing picked.
  return <Browser key={branch} index={index} branch={branch} />;
}

function Browser({ index, branch }: { index: IndexInfo; branch: string }) {
  const [size, setSize] = useState(SIZES[0]!);
  // The cursors of the pages before, so Back needs no cursor from the API.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ limit: String(size), ...(cursor ? { cursor } : {}) });
  const { loaded, reload } = useApi<DocumentPage>(
    branchUrl(index.name, branch, `documents?${query}`),
  );
  // While the next page loads, the last one stays in view.
  const [last, setLast] = useState<DocumentPage | null>(null);
  if (loaded.state === "done" && loaded.value !== last) setLast(loaded.value);
  const page = loaded.state === "done" ? loaded.value : last;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Document | null>(null);
  const [writing, setWriting] = useState(false);

  const documents = page?.documents ?? [];
  const firstRow = (cursors.length - 1) * size + 1;
  const attributes = index.schema.attributes.map((a) => a.name);
  // A text-only index has no vector to preview.
  const vector = index.schema.vectors[0];
  const allSelected = documents.length > 0 && documents.every((d) => selected.has(keyOf(d.id)));

  function toggle(id: DocId) {
    setSelected((before) => {
      const next = new Set(before);
      if (!next.delete(keyOf(id))) next.add(keyOf(id));
      return next;
    });
  }

  async function remove(ids: DocId[]) {
    try {
      const { count } = await call<{ count: number }>(
        "POST",
        branchUrl(index.name, branch, "documents/delete"),
        { ids },
      );
      toast.success(`Deleted ${plural(count, "row")}`);
      setSelected(new Set());
      setOpen(null);
      reload();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Lookup index={index} branch={branch} onFound={setOpen} />
        <span className="ml-auto" />
        <Button leadingIcon={RotateCw} size="default" onClick={reload} aria-label="Refresh">
          <span className="max-sm:hidden">Refresh</span>
        </Button>
        <Button
          leadingIcon={writing ? X : Upload}
          size="default"
          variant={writing ? "ghost" : "primary"}
          onClick={() => setWriting(!writing)}
        >
          {writing ? "Close" : "Write rows"}
        </Button>
      </div>

      {writing && (
        <Write
          index={index}
          branch={branch}
          onWritten={() => {
            setCursors([undefined]);
            reload();
          }}
        />
      )}

      <Panel
        title="Rows"
        action={
          selected.size > 0 ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums">
                {selected.size} selected
              </span>
              <Button size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="danger"
                leadingIcon={Trash2}
                onClick={() =>
                  remove(documents.filter((d) => selected.has(keyOf(d.id))).map((d) => d.id))
                }
              >
                Delete
              </Button>
            </>
          ) : (
            <span className="text-xs text-faint">By id · on {branch}</span>
          )
        }
      >
        {loaded.state === "failed" ? (
          <p className="px-4 py-3 text-sm text-destructive">{loaded.error}</p>
        ) : !page ? (
          <Rows count={6} className="px-4 pt-3" />
        ) : documents.length === 0 ? (
          <Empty title={`No rows on ${branch}`} columns={["Id", "Fields"]}>
            <p>Write some as JSON here, or with the SDKs. They show by id.</p>
            {!writing && (
              <Button
                leadingIcon={Upload}
                variant="primary"
                className="mt-4"
                onClick={() => setWriting(true)}
              >
                Write rows
              </Button>
            )}
          </Empty>
        ) : (
          <div
            className={cn(
              "overflow-x-auto transition-opacity",
              loaded.state === "loading" && "opacity-60",
            )}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="h-10 border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="w-10 pl-4">
                    <Checkbox
                      label="Select every row on this page"
                      on={allSelected}
                      onClick={() =>
                        setSelected(
                          allSelected ? new Set() : new Set(documents.map((d) => keyOf(d.id))),
                        )
                      }
                    />
                  </th>
                  <th className="px-3 font-normal">id</th>
                  {attributes.map((name) => (
                    <th key={name} className="px-3 font-normal max-md:hidden">
                      {name}
                    </th>
                  ))}
                  {vector && <th className="px-3 pr-4 font-normal">{vector.name}</th>}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const key = keyOf(doc.id);
                  return (
                    <tr
                      key={key}
                      onClick={() => setOpen(doc)}
                      className={cn(
                        "h-10 cursor-pointer border-b border-border/60 last:border-0",
                        selected.has(key) ? "bg-selected" : "hover:bg-hover",
                        open && keyOf(open.id) === key && "bg-hover",
                      )}
                    >
                      <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          label={`Select ${String(doc.id)}`}
                          on={selected.has(key)}
                          onClick={() => toggle(doc.id)}
                        />
                      </td>
                      <td className="max-w-56 truncate px-3">
                        {String(doc.id)}
                        {typeof doc.id === "string" && /^\d+$/.test(doc.id) && (
                          <span className="ml-1.5 text-xs text-faint">text</span>
                        )}
                      </td>
                      {attributes.map((name) => (
                        <td
                          key={name}
                          className="max-w-48 truncate px-3 text-muted-foreground max-md:hidden"
                        >
                          {format(doc.attributes[name])}
                        </td>
                      ))}
                      {vector && (
                        <td className="px-3 pr-4 font-mono text-xs whitespace-nowrap text-muted-foreground">
                          {preview(doc.vectors[vector.name] ?? [], 3)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {page && (documents.length > 0 || cursors.length > 1) && (
          <div className="flex h-11 items-center gap-2 border-t px-4 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {documents.length
                ? `${firstRow.toLocaleString()}–${(firstRow + documents.length - 1).toLocaleString()}`
                : "None"}
            </span>
            <span className="ml-auto max-sm:hidden">Per page</span>
            <Select
              aria-label="Rows per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setCursors([undefined]);
                setSelected(new Set());
              }}
              className="h-7 max-sm:ml-auto"
            >
              {SIZES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
            <Button
              size="sm"
              aria-label="Page before"
              leadingIcon={ChevronLeft}
              disabled={cursors.length === 1}
              onClick={() => (setSelected(new Set()), setCursors(cursors.slice(0, -1)))}
            />
            <Button
              size="sm"
              aria-label="Next page"
              leadingIcon={ChevronRight}
              disabled={!page.next || loaded.state === "loading"}
              onClick={() => (setSelected(new Set()), setCursors([...cursors, page.next!]))}
            />
          </div>
        )}
      </Panel>

      <Detail
        index={index}
        doc={open}
        onClose={() => setOpen(null)}
        onDelete={(id) => remove([id])}
      />
    </div>
  );
}

/** Opens a row by id, typed or pasted. */
function Lookup({
  index,
  branch,
  onFound,
}: {
  index: IndexInfo;
  branch: string;
  onFound: (doc: Document) => void;
}) {
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function find(event: FormEvent) {
    event.preventDefault();
    if (!id.trim()) return;
    setBusy(true);
    setError("");
    try {
      const path = `documents/${encodeURIComponent(id.trim())}`;
      onFound(await call<Document>("GET", branchUrl(index.name, branch, path)));
      setId("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={find} className="relative flex min-w-0 items-center max-sm:w-full">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
      <TextField
        aria-label="Find a row by id"
        placeholder="Find by id"
        value={id}
        onChange={(e) => (setError(""), setId(e.target.value))}
        disabled={busy}
        className={cn("w-64 pl-8 max-sm:w-full", error && "bg-destructive/10")}
      />
      {error && (
        <span role="alert" className="absolute top-full left-0 mt-1 text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}

/** One row whole: its fields, every vector, and its JSON. */
function Detail({
  index,
  doc: picked,
  onClose,
  onDelete,
}: {
  index: IndexInfo;
  doc: Document | null;
  onClose: () => void;
  onDelete: (id: DocId) => void;
}) {
  const [doc, setDoc] = useState(picked);
  if (picked && picked !== doc) setDoc(picked);
  const { attributes } = index.schema;
  return (
    <Dialog open={picked !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        size="lg"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-h-[85dvh] flex-col p-0"
      >
        {doc && (
          <>
            <div className="grid gap-1 border-b px-6 pt-5 pb-4 pr-12">
              <DialogTitle className="text-base font-semibold break-all">
                {String(doc.id)}
              </DialogTitle>
              <DialogDescription className="text-xs text-faint">
                {typeof doc.id === "number" ? "Number id" : "String id"} · {nameInEnv(index.name)}
              </DialogDescription>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="grid gap-4 px-6 py-5">
                {attributes.length === 0 && (
                  <p className="text-sm text-muted-foreground">This index has no fields.</p>
                )}
                {attributes.map((a) => (
                  <Field key={a.name} name={a.name} type={a.type} value={doc.attributes[a.name]} />
                ))}
              </section>
              {index.schema.vectors.map((v) => (
                <VectorView
                  key={v.name}
                  name={v.name}
                  values={doc.vectors[v.name] ?? []}
                  normalized={v.metric === "cosine"}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 border-t px-6 py-3">
              <CopyButton text={JSON.stringify(doc, null, 2)} label="Copy JSON" />
              <span className="ml-auto" />
              <ConfirmDelete key={keyOf(doc.id)} onDelete={() => onDelete(doc.id)} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ name, type, value }: { name: string; type: string; value?: AttributeValue }) {
  const long = typeof value === "string" && value.length > 120;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">{name}</span>
        <span className="text-micro text-faint">{type}</span>
      </div>
      <p
        className={cn(
          "text-sm break-words",
          long &&
            "max-h-56 overflow-y-auto rounded-md bg-muted/50 p-3 leading-6 whitespace-pre-wrap",
          value === undefined && "text-faint",
        )}
      >
        {format(value)}
      </p>
    </div>
  );
}

/** Asks once more before it deletes. */
function ConfirmDelete({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <>
      <Button size="default" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <Button size="default" variant="danger" leadingIcon={Trash2} onClick={onDelete}>
        Delete it
      </Button>
    </>
  ) : (
    <Button size="default" leadingIcon={Trash2} onClick={() => setConfirming(true)}>
      Delete
    </Button>
  );
}

function VectorView({
  name,
  values,
  normalized,
}: {
  name: string;
  values: number[];
  normalized: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const norm = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0));
  return (
    <section className="grid gap-2 border-t px-6 py-4">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? "Hide" : "Show"} {name}
        </button>
        <span className="text-xs text-faint tabular-nums">
          {values.length} dims · length {norm.toFixed(3)}
          {normalized && " · normalized for cosine"}
        </span>
        <span className="ml-auto" />
        <CopyButton text={JSON.stringify(values)} label="Copy" small />
      </div>
      {open && (
        <>
          <p className="max-h-64 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-5 break-all text-muted-foreground">
            {all ? `[${values.map(round).join(", ")}]` : preview(values, 12)}
          </p>
          {values.length > 12 && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="w-fit text-xs text-muted-foreground hover:text-foreground"
            >
              {all ? "Show less" : `Show all ${values.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Write({
  index,
  branch,
  onWritten,
}: {
  index: IndexInfo;
  branch: string;
  onWritten: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const placeholder = JSON.stringify(
    [
      {
        id: 1,
        // A short vector shows its real length; a long one only its start.
        vectors: Object.fromEntries(
          index.schema.vectors.map((v) => [v.name, Array(Math.min(v.dims, 4)).fill(0.1)]),
        ),
        attributes: Object.fromEntries(
          index.schema.attributes.slice(0, 2).map((a) => [a.name, "…"]),
        ),
      },
    ],
    null,
    2,
  );

  async function write() {
    setBusy(true);
    setError("");
    try {
      const parsed = JSON.parse(text);
      const documents = Array.isArray(parsed) ? parsed : [parsed];
      const { count } = await call<{ count: number }>(
        "POST",
        branchUrl(index.name, branch, "documents"),
        { documents },
      );
      toast.success(`Wrote ${plural(count, "row")}`);
      setText("");
      onWritten();
    } catch (failure) {
      // The API's message starts with the path of the field that is wrong.
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <Panel
      title="Write rows"
      action={<span className="text-xs text-faint">Each replaces any row with its id</span>}
    >
      <div className="grid gap-3 px-4 pt-4">
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="min-h-40"
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          leadingIcon={Upload}
          variant="primary"
          size="default"
          className="w-fit"
          disabled={busy || !text.trim()}
          onClick={write}
        >
          Write to {branch}
        </Button>
      </div>
    </Panel>
  );
}

function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size={small ? "sm" : "default"}
      leadingIcon={copied ? Check : Copy}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

const round = (x: number) => Number(x.toPrecision(4));

/** The first numbers of a vector and how many it has. */
function preview(values: number[], count: number) {
  const head = values.slice(0, count).map(round).join(", ");
  return values.length > count ? `[${head}, …] ${values.length}` : `[${head}]`;
}

const format = (value: AttributeValue | undefined) =>
  value === undefined ? "—" : Array.isArray(value) ? value.join(", ") : String(value);
