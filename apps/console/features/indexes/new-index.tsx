"use client";

import { Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skywake/ui/components/dialog";
import { cn } from "@skywake/ui/lib/utils";
import { Button } from "@/components/kit";
import { navigate } from "@/components/shell/router";
import { useRegions } from "@/features/environments/regions";
import { defaultRegion, RegionPicker } from "@/features/environments/region-picker";
import { namespaceName } from "@/lib/names";
import { indexApi, indexPath } from "@/lib/paths";
import {
  type AttributeColumn,
  type Metric,
  type Schema,
  type VectorColumn,
  ApiError,
  call,
} from "./api";
import { Label, Select, TextField } from "./fields";

const METRICS: { value: Metric; note: string }[] = [
  { value: "cosine", note: "The angle between vectors. Right for most text embeddings." },
  {
    value: "euclidean",
    note: "The straight-line distance. For vectors whose length means something.",
  },
  { value: "dot", note: "The dot product. For normalized vectors, or models trained for it." },
];
const TYPES: { value: AttributeColumn["type"]; note: string }[] = [
  { value: "string", note: "eq, in, lt, gt" },
  { value: "number", note: "eq, in, lt, gt" },
  { value: "bool", note: "eq, in" },
  { value: "strings", note: "a list; eq and in match any item" },
  { value: "text", note: "searched by BM25; phrase and prefix in a search" },
];
// Common embedding sizes, offered as the dims field is typed.
const DIMS = [384, 512, 768, 1024, 1536, 3072];

// The same limits as the API, so most mistakes show before a request.
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DIMS_MAX = 4096;
const VECTORS_MAX = 8;
const ATTRIBUTES_MAX = 64;
const FILTER_WORDS = ["and", "or", "not"];

type Errors = Record<string, string>;

/** What is wrong with the form, by field: `name`, `vectors.0.dims`, `attributes.1.name`. */
function check(name: string, vectors: VectorColumn[], attributes: AttributeColumn[]): Errors {
  const errors: Errors = {};
  if (!name) errors.name = "Give the index a name";
  else if (!NAME.test(name)) errors.name = "Use letters, digits, `.`, `_` and `-`, split by `/`";
  const column = (key: string, value: string, seen: Set<string>) => {
    if (!value) errors[key] = "Needs a name";
    else if (!COLUMN.test(value)) errors[key] = "Letters, digits and `_`; not a digit first";
    else if (seen.has(value)) errors[key] = "Two columns have this name";
    seen.add(value);
  };
  if (!vectors.length && !attributes.some((a) => a.type === "text")) {
    errors.vectors = "Add a vector column or a text attribute";
  }
  const vectorNames = new Set<string>();
  vectors.forEach((v, i) => {
    column(`vectors.${i}.name`, v.name, vectorNames);
    if (!Number.isInteger(v.dims) || v.dims < 1 || v.dims > DIMS_MAX) {
      errors[`vectors.${i}.dims`] = `1 to ${DIMS_MAX}`;
    }
  });
  const attributeNames = new Set<string>();
  attributes.forEach((a, i) => {
    const key = `attributes.${i}.name`;
    column(key, a.name, attributeNames);
    if (FILTER_WORDS.includes(a.name)) errors[key] = "`and`, `or` and `not` are filter words";
  });
  return errors;
}

/** `schema.vectors[0].dims` from the API, as this form names its fields. */
const fieldOf = (path: string) => path.replace(/^schema\./, "").replace(/\[(\d+)\]/g, ".$1");

/** Makes an index in an environment: its name, region, vector columns and attributes. */
export function NewIndex({
  env,
  open,
  onOpenChange,
  onCreated,
}: {
  env: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const regions = useRegions();
  const [picked, setPicked] = useState<string>();
  const region = picked ?? defaultRegion(regions);
  const [name, setName] = useState("");
  const [vectors, setVectors] = useState<VectorColumn[]>([
    { name: "embedding", dims: 768, metric: "cosine" },
  ]);
  const [attributes, setAttributes] = useState<AttributeColumn[]>([]);
  // Errors show once the field was left or the form was sent, not while typing.
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [serverError, setServerError] = useState<{ field?: string; message: string }>();
  const [busy, setBusy] = useState(false);
  // A row added by hand takes the focus; rows there from the start do not.
  const [added, setAdded] = useState(false);

  const errors = check(name.trim(), vectors, attributes);
  if (serverError?.field && !errors[serverError.field])
    errors[serverError.field] = serverError.message;
  const errorOf = (field: string) =>
    shown.has(field) || serverError?.field === field ? errors[field] : undefined;
  // A field left empty says nothing until the form is sent.
  const touch = (field: string) => (event: { target: { value: string } }) => {
    if (event.target.value) setShown((all) => new Set(all).add(field));
  };

  function reset() {
    setName("");
    setPicked(undefined);
    setVectors([{ name: "embedding", dims: 768, metric: "cosine" }]);
    setAttributes([]);
    setShown(new Set());
    setServerError(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(errors).length) {
      setShown(new Set(Object.keys(errors)));
      return;
    }
    const full = namespaceName(env, name.trim());
    const schema: Schema = { vectors, attributes };
    setBusy(true);
    setServerError(undefined);
    try {
      await call("POST", indexApi(), {
        name: full,
        schema,
        region,
      });
      onOpenChange(false);
      onCreated();
      reset();
      toast.success(`Created ${full}`);
      navigate(indexPath(full));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      const path = failure instanceof ApiError ? failure.path : undefined;
      // The API's message starts with the path; the field shows it already.
      const field = path && fieldOf(path);
      setServerError({ field, message: path ? message.replace(`${path}: `, "") : message });
    }
    setBusy(false);
  }

  const setVector = (i: number, change: Partial<VectorColumn>) => {
    setServerError(undefined);
    setVectors(vectors.map((v, j) => (i === j ? { ...v, ...change } : v)));
  };
  const setAttribute = (i: number, change: Partial<AttributeColumn>) => {
    setServerError(undefined);
    setAttributes(attributes.map((a, j) => (i === j ? { ...a, ...change } : a)));
  };
  // Removing a row moves the rows after it up, so their shown errors move too.
  const dropRow = (list: "vectors" | "attributes", i: number) =>
    setShown(
      (all) =>
        new Set(
          [...all].flatMap((key) => {
            const [kind, at, field] = key.split(".");
            if (kind !== list || at === undefined) return [key];
            const n = Number(at);
            return n === i ? [] : [n > i ? `${kind}.${n - 1}.${field}` : key];
          }),
        ),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setServerError(undefined);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base">New index in {env}</DialogTitle>
          <DialogDescription className="text-sm">
            Every document has an id, a vector for each vector column, and any of the attributes.
            The schema can&apos;t change later; make a new index for a new one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-6">
          <Section label="Name" error={errorOf("name")}>
            <div className="rounded-md flex min-w-0 items-center bg-muted/60 font-mono text-sm focus-within:bg-muted">
              <span className="shrink-0 pl-2.5 text-faint">{env}/</span>
              <input
                aria-label="Name"
                aria-invalid={!!errorOf("name")}
                placeholder="products"
                value={name}
                onChange={(event) => (setServerError(undefined), setName(event.target.value))}
                onBlur={touch("name")}
                autoFocus
                className="h-8 min-w-0 flex-1 bg-transparent pr-2.5 outline-none"
              />
            </div>
          </Section>

          <Section label="Region">
            <RegionPicker regions={regions} value={region} onChange={setPicked} />
          </Section>

          <Section
            label="Vector columns"
            hint={`${vectors.length} of ${VECTORS_MAX}`}
            error={errorOf("vectors")}
          >
            <div className="grid grid-cols-[1fr_6rem_8rem_2rem] gap-x-2 font-mono text-micro tracking-wide text-faint uppercase max-sm:hidden">
              <span>Column</span>
              <span>Dims</span>
              <span>Metric</span>
            </div>
            <datalist id="index-dims">
              {DIMS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            {vectors.map((column, i) => {
              const nameError = errorOf(`vectors.${i}.name`);
              const dimsError = errorOf(`vectors.${i}.dims`);
              return (
                <div key={i} className="grid gap-1">
                  <div className="grid grid-cols-[1fr_6rem_8rem_2rem] items-center gap-2 max-sm:grid-cols-[1fr_5rem_2rem]">
                    <TextField
                      aria-label="Column name"
                      autoFocus={added && i === vectors.length - 1}
                      aria-invalid={!!nameError}
                      value={column.name}
                      placeholder="embedding"
                      onChange={(e) => setVector(i, { name: e.target.value })}
                      onBlur={touch(`vectors.${i}.name`)}
                      className={cn("font-mono", nameError && "bg-destructive/10")}
                    />
                    <TextField
                      aria-label="Dimensions"
                      aria-invalid={!!dimsError}
                      type="number"
                      inputMode="numeric"
                      list="index-dims"
                      min={1}
                      max={DIMS_MAX}
                      value={Number.isNaN(column.dims) ? "" : column.dims}
                      onChange={(e) => setVector(i, { dims: e.target.valueAsNumber })}
                      onBlur={touch(`vectors.${i}.dims`)}
                      className={cn("tabular-nums", dimsError && "bg-destructive/10")}
                    />
                    <Select
                      aria-label="Metric"
                      value={column.metric}
                      onChange={(e) => setVector(i, { metric: e.target.value as Metric })}
                      className="max-sm:order-last max-sm:col-span-2"
                    >
                      {METRICS.map((m) => (
                        <option key={m.value}>{m.value}</option>
                      ))}
                    </Select>
                    <Remove
                      label={`Remove ${column.name || "vector column"}`}
                      disabled={vectors.length === 1 && !attributes.some((a) => a.type === "text")}
                      onClick={() => {
                        dropRow("vectors", i);
                        setVectors(vectors.filter((_, j) => j !== i));
                      }}
                    />
                  </div>
                  <FieldNote error={nameError ?? dimsError}>
                    {METRICS.find((m) => m.value === column.metric)!.note}
                  </FieldNote>
                </div>
              );
            })}
            {vectors.length < VECTORS_MAX && (
              <Add
                onClick={() => {
                  setAdded(true);
                  setVectors([
                    ...vectors,
                    { name: "", dims: vectors[0]?.dims ?? 768, metric: "cosine" },
                  ]);
                }}
              >
                Vector column
              </Add>
            )}
          </Section>

          <Section
            label="Attributes"
            hint={attributes.length ? `${attributes.length} of ${ATTRIBUTES_MAX}` : "optional"}
          >
            {attributes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Values stored with each document, to filter on and to return with hits.
              </p>
            )}
            {attributes.map((column, i) => {
              const error = errorOf(`attributes.${i}.name`);
              return (
                <div key={i} className="grid gap-1">
                  <div className="grid grid-cols-[1fr_8rem_2rem] items-center gap-2">
                    <TextField
                      aria-label="Attribute name"
                      autoFocus={added && i === attributes.length - 1}
                      aria-invalid={!!error}
                      value={column.name}
                      placeholder="category"
                      onChange={(e) => setAttribute(i, { name: e.target.value })}
                      onBlur={touch(`attributes.${i}.name`)}
                      className={cn("font-mono", error && "bg-destructive/10")}
                    />
                    <Select
                      aria-label="Type"
                      value={column.type}
                      onChange={(e) =>
                        setAttribute(i, { type: e.target.value as AttributeColumn["type"] })
                      }
                    >
                      {TYPES.map((t) => (
                        <option key={t.value}>{t.value}</option>
                      ))}
                    </Select>
                    <Remove
                      label={`Remove ${column.name || "attribute"}`}
                      onClick={() => {
                        dropRow("attributes", i);
                        setAttributes(attributes.filter((_, j) => j !== i));
                      }}
                    />
                  </div>
                  <FieldNote error={error}>
                    {column.type === "text"
                      ? "Searched by BM25: phrase and prefix filters, highlights"
                      : `Filters: ${TYPES.find((t) => t.value === column.type)!.note}`}
                  </FieldNote>
                </div>
              );
            })}
            {attributes.length < ATTRIBUTES_MAX && (
              <Add
                onClick={() => {
                  setAdded(true);
                  setAttributes([...attributes, { name: "", type: "string" }]);
                }}
              >
                Attribute
              </Add>
            )}
          </Section>

          {serverError && !serverError.field && (
            <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError.message}
            </p>
          )}
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-faint max-sm:hidden">{summary(vectors, attributes)}</span>
            <div className="flex gap-2 max-sm:flex-col-reverse">
              <DialogClose asChild>
                <Button size="default" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button size="default" variant="primary" disabled={busy || !region}>
                {busy ? "Creating…" : "Create index"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const summary = (vectors: VectorColumn[], attributes: AttributeColumn[]) => {
  const named = vectors.filter((v) => v.name && v.dims);
  const parts = named.map((v) => `${v.name} ${v.dims}d`);
  const texts = attributes.filter((a) => a.name && a.type === "text").length;
  if (texts) parts.push(`${texts} text`);
  return `${parts.join(", ") || "No vector column yet"}${
    attributes.length
      ? ` · ${attributes.length} attribute${attributes.length === 1 ? "" : "s"}`
      : ""
  }`;
};

function Section({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline gap-2">
        <Label>{label}</Label>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

/** A field's error if it has one, else a quiet hint. */
function FieldNote({ error, children }: { error?: string; children: string }) {
  return (
    <p className={cn("text-xs", error ? "text-destructive" : "text-faint")}>{error ?? children}</p>
  );
}

function Add({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-fit items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <Plus className="size-3.5" /> {children}
    </button>
  );
}

function Remove({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md grid size-8 shrink-0 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <X className="size-3.5" />
    </button>
  );
}
