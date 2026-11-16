"use client";

import { Play } from "lucide-react";
import { type FormEvent, Fragment, useState } from "react";
import { Button, Choice, Panel, cx as cn } from "@/components/kit";
import { useUrls } from "@/components/shell/console";
import {
  ApiError,
  type FusedHit,
  type Highlight,
  type Hit,
  type IndexInfo,
  type SearchHit,
  branchUrl,
  call,
  useApi,
} from "./api";
import { apiPath, indexApi } from "@/lib/paths";
import { CodeBlock, LangChoice } from "./code";
import { Label, Select, TextArea, TextField } from "./fields";
import { ImagePick, type Picked, SHOWN_IMAGE } from "./image-pick";
import { type Condition, FilterBuilder, toFilter } from "./filter-builder";
import { type Lang, type QueryBody, type Request, type SearchBody, snippet } from "./snippets";

/** `[0.1, 0.2]`, or numbers split by commas or spaces. */
function parseVector(text: string, embeds: boolean): number[] | string {
  const trimmed = text.trim();
  if (!trimmed)
    throw new Error(embeds ? "Type text or paste a vector first" : "Paste a vector first");
  const numbers = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed.split(/[\s,]+/).map(Number);
  if (numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return numbers as number[];
  if (embeds && !trimmed.startsWith("[")) return trimmed;
  throw new Error("The vector holds something that is not a number");
}

type Kind = "vector" | "text" | "hybrid";

const KINDS: { value: Kind; label: string }[] = [
  { value: "vector", label: "Vector" },
  { value: "text", label: "Text" },
  { value: "hybrid", label: "Hybrid" },
];

/** How long `work` takes, in milliseconds. */
async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
}

/** `""` as unset, else the number. */
const optional = (text: string) => (text.trim() ? Number(text) : undefined);

const HIDDEN = new Set(["grams", "hash"]);

/** Runs queries by hand, and shows them as code to paste. */
export function QueryPlayground({ index, branch }: { index: IndexInfo; branch: string }) {
  const { schema } = index;
  const api = useUrls().api;
  const shown = schema.attributes.filter((a) => !HIDDEN.has(a.name));
  const texts = shown.filter((a) => a.type === "text");
  const others = shown.filter((a) => a.type !== "text");
  const kinds = KINDS.filter(
    (k) =>
      (k.value !== "vector" || schema.vectors.length) &&
      (k.value !== "text" || texts.length) &&
      (k.value !== "hybrid" || (schema.vectors.length && texts.length)),
  );
  const linked = schema.attributes.some((a) => a.name === "chunk");
  const preferred = linked && kinds.some((k) => k.value === "hybrid") ? "hybrid" : kinds[0]!.value;
  const [kind, setKind] = useState<Kind>(preferred);
  const thumb = useThumbnails(index.name, branch, linked);
  const [column, setColumn] = useState(schema.vectors[0]?.name ?? "");
  const [vector, setVector] = useState("");
  const [image, setImage] = useState<Picked | null>(null);
  const [words, setWords] = useState("");
  // Per text attribute: a boost, `""` for 1.
  const [boosts, setBoosts] = useState<Record<string, string>>({});
  const [k1, setK1] = useState("");
  const [b, setB] = useState("");
  const [rankK, setRankK] = useState("");
  const [textWeight, setTextWeight] = useState("");
  const [mode, setMode] = useState<"builder" | "json">("builder");
  const [rows, setRows] = useState<Condition[]>([]);
  const [filterText, setFilterText] = useState("");
  const [topK, setTopK] = useState(10);
  const [probe, setProbe] = useState("");
  // Empty means the server's default target.
  const [recall, setRecall] = useState<number | null>(null);
  const [hits, setHits] = useState<{ hits: AnyHit[]; ms: number } | null>(null);
  const [error, setError] = useState<{ message: string; path?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>("ts");
  const picked = schema.vectors.find((v) => v.name === column);
  const dims = picked?.dims;
  const embed = picked?.embed;
  // Text is long, so hits show its highlighted fragment instead.
  const include = others.map((a) => a.name);
  const highlight = texts.map((a) => a.name);
  // Phrases filter only a text search.
  const filterable = kind === "text" ? schema.attributes : others;

  function filter() {
    if (mode === "builder") return toFilter(filterable, rows);
    return filterText.trim() ? JSON.parse(filterText) : undefined;
  }

  function vectorBody(brief = false): QueryBody {
    const f = filter();
    const value =
      embed && image ? { image: brief ? SHOWN_IMAGE : image.url } : parseVector(vector, !!embed);
    return {
      vector: { column, value },
      topK,
      ...(probe ? { probe: Number(probe) } : recall !== null ? { recall } : {}),
      ...(f === undefined ? {} : { filter: f }),
      ...(include.length ? { include } : {}),
    };
  }

  function textBody(): SearchBody {
    if (!words.trim()) throw new Error("Type a query first");
    const f = filter();
    const set = Object.entries(boosts).filter(([, v]) => v.trim() && Number(v) !== 1);
    return {
      query: words,
      topK,
      ...(set.length ? { boosts: Object.fromEntries(set.map(([n, v]) => [n, Number(v)])) } : {}),
      ...(optional(k1) === undefined ? {} : { k1: optional(k1) }),
      ...(optional(b) === undefined ? {} : { b: optional(b) }),
      ...(f === undefined ? {} : { filter: f }),
      ...(include.length ? { include } : {}),
      highlight,
    };
  }

  /** The request. Throws while the form cannot make one. */
  function request(brief = false): Request {
    if (kind === "vector") return { route: "query", body: vectorBody(brief) };
    if (kind === "text") return { route: "search", body: textBody() };
    const weight = optional(textWeight);
    const k = optional(rankK);
    const fuse = {
      ...(k === undefined ? {} : { k }),
      ...(weight === undefined ? {} : { weights: { text: weight } }),
    };
    return {
      route: "hybrid",
      body: {
        searches: { vector: vectorBody(brief), text: textBody() },
        topK,
        ...(Object.keys(fuse).length ? { fuse } : {}),
      },
    };
  }

  let code = "";
  try {
    code = snippet(lang, index.name, branch, request(true), api);
  } catch {
    code = "";
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { route, body } = request();
      const { value, ms } = await timed(() =>
        call<{ hits: AnyHit[] }>("POST", branchUrl(index.name, branch, route), body),
      );
      setHits({ hits: value.hits, ms });
    } catch (failure) {
      setError({
        message: failure instanceof Error ? failure.message : String(failure),
        path: failure instanceof ApiError ? failure.path : undefined,
      });
    }
    setBusy(false);
  }

  const topKField = (
    <label className="grid gap-1.5">
      <Label>Top k</Label>
      <TextField
        type="number"
        min={1}
        max={1000}
        value={topK}
        onChange={(e) => setTopK(Number(e.target.value))}
        className="w-20 tabular-nums"
      />
    </label>
  );

  const vectorFields = (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <Label>
          {embed
            ? `Text, image or vector · embedded by ${embed.model}`
            : `Vector · ${dims ?? "?"} numbers`}
        </Label>
        {!(embed && image) && (
          <TextArea
            value={vector}
            onChange={(e) => setVector(e.target.value)}
            placeholder={embed ? "What to find, in your own words" : "[0.12, -0.03, 0.88, …]"}
            className="min-h-20"
          />
        )}
      </label>
      {embed && <ImagePick picked={image} onPick={setImage} />}
      <div className="flex flex-wrap items-end gap-3">
        {topKField}
        <Recall value={recall} onChange={setRecall} overridden={!!probe} />
        <label className="grid gap-1.5">
          <Label>Probe</Label>
          <TextField
            type="number"
            min={1}
            placeholder="auto"
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            className="w-20 tabular-nums"
          />
        </label>
      </div>
    </div>
  );

  const textFields = (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <Label>Query</Label>
        <TextField
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="reset password"
          className="h-10 px-3 text-[15px]"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {kind === "text" && topKField}
        {texts.map((a) => (
          <label key={a.name} className="grid gap-1.5">
            <Label>{`${a.name} boost`}</Label>
            <TextField
              type="number"
              min={0}
              step={0.1}
              placeholder="1"
              value={boosts[a.name] ?? ""}
              onChange={(e) => setBoosts({ ...boosts, [a.name]: e.target.value })}
              className="w-20 tabular-nums"
            />
          </label>
        ))}
        <label className="grid gap-1.5">
          <Label>k1</Label>
          <TextField
            type="number"
            min={0}
            step={0.1}
            placeholder={String(texts[0]?.k1 ?? 1.2)}
            value={k1}
            onChange={(e) => setK1(e.target.value)}
            className="w-20 tabular-nums"
          />
        </label>
        <label className="grid gap-1.5">
          <Label>b</Label>
          <TextField
            type="number"
            min={0}
            max={1}
            step={0.05}
            placeholder={String(texts[0]?.b ?? 0.75)}
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="w-20 tabular-nums"
          />
        </label>
      </div>
    </div>
  );

  return (
    <div className="grid gap-10">
      <form onSubmit={run} className="grid gap-5">
        <div className="flex flex-wrap items-end gap-3 empty:hidden">
          {kinds.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Search</Label>
              <Choice
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setRows([]);
                  setHits(null);
                }}
                options={kinds}
              />
            </div>
          )}
          {kind !== "text" && (
            <label className="grid gap-1.5">
              <Label>Column</Label>
              <Select value={column} onChange={(e) => setColumn(e.target.value)}>
                {schema.vectors.map((v) => (
                  <option key={v.name}>{v.name}</option>
                ))}
              </Select>
            </label>
          )}
        </div>

        {kind !== "text" && vectorFields}
        {kind !== "vector" && textFields}

        {kind === "hybrid" && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5">
              <Label>Rank constant k</Label>
              <TextField
                type="number"
                min={0}
                placeholder="60"
                value={rankK}
                onChange={(e) => setRankK(e.target.value)}
                className="w-24 tabular-nums"
              />
            </label>
            <label className="grid gap-1.5">
              <Label>Text weight</Label>
              <TextField
                type="number"
                min={0}
                step={0.1}
                placeholder="1"
                value={textWeight}
                onChange={(e) => setTextWeight(e.target.value)}
                className="w-24 tabular-nums"
              />
            </label>
            <p className="pb-2 text-xs text-faint">
              Each hit scores the sum of weight / (k + rank) over both searches.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <Label>Filter</Label>
            <Choice
              value={mode}
              onChange={setMode}
              options={[
                { value: "builder", label: "Builder" },
                { value: "json", label: "JSON" },
              ]}
            />
          </div>
          {mode === "builder" ? (
            <FilterBuilder attributes={filterable} rows={rows} onChange={setRows} />
          ) : (
            <TextArea
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={
                kind === "text"
                  ? `{"${texts[0]?.name ?? "body"}": {"phrase": "reset password"}}`
                  : '{"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]}'
              }
            />
          )}
        </div>

        {error && (
          <p className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.path && <span className="mr-2 font-mono text-xs">{error.path}</span>}
            {error.message}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="primary" size="default" leadingIcon={Play} disabled={busy}>
            {kind === "vector" ? "Run query" : "Run search"}
          </Button>
          <span className="text-xs text-faint">on {branch}</span>
        </div>
      </form>

      {hits && (
        <Results hits={hits.hits} ms={hits.ms} kind={kind} attributes={include} thumb={thumb} />
      )}

      <Panel title="As code" action={<LangChoice value={lang} onChange={setLang} />}>
        {code ? (
          <CodeBlock code={code} />
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {kind === "text"
              ? "Type a query, and a valid filter if any, to see the code."
              : embed
                ? "Type text or paste a vector, and a valid filter if any, to see the code."
                : "Paste a vector, and a valid filter if any, to see the code."}
          </p>
        )}
      </Panel>
    </div>
  );
}

const RECALL_DEFAULT = 0.95;

/**
 * The share of the true nearest to find. The index reads as many clusters as
 * its last build measured that takes, so a lower target answers faster.
 */
function Recall({
  value,
  onChange,
  overridden,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  overridden: boolean;
}) {
  const shown = value ?? RECALL_DEFAULT;
  return (
    <div className={cn("grid gap-1.5", overridden && "opacity-50")}>
      <div className="flex items-baseline gap-2">
        <Label>Recall</Label>
        <span className="text-xs tabular-nums">{shown === 1 ? "exact" : shown.toFixed(2)}</span>
        {value === null ? (
          <span className="text-xs text-faint">default</span>
        ) : (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-faint hover:text-foreground"
          >
            reset
          </button>
        )}
      </div>
      <input
        type="range"
        aria-label="Recall target"
        title={overridden ? "Probe is set, so it decides how much to read" : undefined}
        min={0.5}
        max={1}
        step={0.01}
        value={shown}
        disabled={overridden}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-8 w-40 accent-foreground"
      />
    </div>
  );
}

type AnyHit = Hit | SearchHit | FusedHit;
type Thumb = ((path: string) => string) | null;

function useThumbnails(index: string, branch: string, linked: boolean): Thumb {
  const { loaded } = useApi<{ namespace: string }>(linked ? indexApi(index, "link") : null);
  if (loaded.state !== "done") return null;
  const disk = loaded.value.namespace;
  return (path) =>
    apiPath(
      disk,
      `branches/${encodeURIComponent(branch)}/files/content?path=${encodeURIComponent(path)}`,
    );
}

function Results({
  hits,
  ms,
  kind,
  attributes,
  thumb,
}: {
  hits: AnyHit[];
  ms: number;
  kind: Kind;
  attributes: string[];
  thumb: Thumb;
}) {
  const span = 2 + (kind === "hybrid" ? 2 : 0) + attributes.length;
  return (
    <Panel
      title="Results"
      count={hits.length}
      action={
        <span
          className="text-xs text-faint tabular-nums"
          title="Through the console, so a little slower than from code"
        >
          {Math.round(ms)} ms
        </span>
      }
    >
      {hits.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="h-10 border-b text-left text-xs text-muted-foreground">
                <th className="px-4 font-normal">Id</th>
                <th className="px-4 text-right font-normal">
                  {kind === "vector" ? "Distance" : "Score"}
                </th>
                {kind === "hybrid" && (
                  <>
                    <th className="px-4 text-right font-normal">Vector rank</th>
                    <th className="px-4 text-right font-normal">Text rank</th>
                  </>
                )}
                {attributes.map((name) => (
                  <th key={name} className="px-4 font-normal">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => {
                const highlights = "highlights" in hit ? Object.entries(hit.highlights) : [];
                return (
                  <Fragment key={String(hit.id)}>
                    <tr
                      className={cn(
                        "h-10 hover:bg-hover",
                        !highlights.length && "border-b border-border/60 last:border-0",
                      )}
                    >
                      <td className="px-4">{String(hit.id)}</td>
                      <td className="px-4 text-right tabular-nums">
                        {"distance" in hit ? hit.distance.toFixed(4) : hit.score.toFixed(4)}
                      </td>
                      {"ranks" in hit && (
                        <>
                          <td className="px-4 text-right text-muted-foreground tabular-nums">
                            {hit.ranks.vector ?? "—"}
                          </td>
                          <td className="px-4 text-right text-muted-foreground tabular-nums">
                            {hit.ranks.text ?? "—"}
                          </td>
                        </>
                      )}
                      {attributes.map((name) => (
                        <td key={name} className="px-4 text-muted-foreground">
                          <span className="flex items-center gap-3 py-1">
                            {name === "path" && thumb && hit.attributes.kind === "image" && (
                              <span
                                role="img"
                                aria-label={format(hit.attributes.path)}
                                style={{
                                  backgroundImage: `url("${thumb(String(hit.attributes.path))}")`,
                                }}
                                className="size-12 shrink-0 rounded-md bg-muted bg-cover bg-center"
                              />
                            )}
                            <span
                              title={format(hit.attributes[name])}
                              className="line-clamp-2 max-w-md break-words"
                            >
                              {format(hit.attributes[name])}
                            </span>
                          </span>
                        </td>
                      ))}
                    </tr>
                    {highlights.length > 0 && (
                      <tr className="border-b border-border/60 last:border-0">
                        <td colSpan={span} className="grid gap-1 px-4 pb-3">
                          {highlights.map(([name, h]) => (
                            <p key={name} className="text-muted-foreground">
                              <span className="mr-2 text-xs text-faint">{name}</span>
                              <Marked highlight={h} />
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nothing matched.</p>
      )}
    </Panel>
  );
}

/** A fragment with its matched words marked. */
function Marked({ highlight }: { highlight: Highlight }) {
  const parts = [];
  let at = 0;
  for (const [start, end] of highlight.marks) {
    parts.push(highlight.text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-transparent font-medium text-foreground">
        {highlight.text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(highlight.text.slice(at));
  return <>{parts}</>;
}

const format = (value: unknown) =>
  value === undefined ? "—" : Array.isArray(value) ? value.join(", ") : String(value);
