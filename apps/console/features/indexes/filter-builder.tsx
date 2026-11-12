"use client";

import { Plus, X } from "lucide-react";
import type { AttributeColumn } from "./api";
import { Select, TextField } from "./fields";

export type Condition = { attribute: string; op: string; value: string };

const OPS: Record<AttributeColumn["type"], string[]> = {
  string: ["eq", "in", "lt", "lte", "gt", "gte"],
  number: ["eq", "in", "lt", "lte", "gt", "gte"],
  bool: ["eq"],
  strings: ["eq", "in"],
  // Only in a text search: the words in order, or with the last as a prefix.
  text: ["phrase", "prefix"],
};

/** A typed value from the text in a row: `in` takes a comma-separated list. */
function parse(type: AttributeColumn["type"], op: string, text: string): unknown {
  const one = (part: string) =>
    type === "number" ? Number(part) : type === "bool" ? part.trim() === "true" : part.trim();
  return op === "in" ? text.split(",").map(one) : one(text);
}

/** The rows as one filter: all of them must hold. Undefined when there are none. */
export function toFilter(attributes: AttributeColumn[], rows: Condition[]) {
  const all = rows
    .filter((row) => row.attribute)
    .map((row) => {
      const type = attributes.find((a) => a.name === row.attribute)?.type ?? "string";
      return { [row.attribute]: { [row.op]: parse(type, row.op, row.value) } };
    });
  if (all.length === 0) return undefined;
  return all.length === 1 ? all[0] : { and: all };
}

/** Rows of attribute, operator and value, all of which must hold. */
export function FilterBuilder({
  attributes,
  rows,
  onChange,
}: {
  attributes: AttributeColumn[];
  rows: Condition[];
  onChange: (rows: Condition[]) => void;
}) {
  if (!attributes.length) {
    return <p className="text-sm text-muted-foreground">This index has no attributes to filter.</p>;
  }
  const set = (i: number, change: Partial<Condition>) =>
    onChange(rows.map((row, j) => (i === j ? { ...row, ...change } : row)));
  return (
    <div className="grid gap-2">
      {rows.map((row, i) => {
        const type = attributes.find((a) => a.name === row.attribute)?.type ?? "string";
        return (
          <div key={i} className="flex items-center gap-2">
            <Select
              aria-label="Attribute"
              value={row.attribute}
              onChange={(e) => {
                const next = attributes.find((a) => a.name === e.target.value)?.type ?? "string";
                set(i, { attribute: e.target.value, op: OPS[next][0]! });
              }}
              className="w-40 font-mono"
            >
              {attributes.map((a) => (
                <option key={a.name}>{a.name}</option>
              ))}
            </Select>
            <Select
              aria-label="Operator"
              value={row.op}
              onChange={(e) => set(i, { op: e.target.value })}
            >
              {OPS[type].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </Select>
            <TextField
              aria-label="Value"
              placeholder={
                row.op === "in"
                  ? "a, b, c"
                  : type === "bool"
                    ? "true"
                    : type === "text"
                      ? "reset password"
                      : "value"
              }
              value={row.value}
              onChange={(e) => set(i, { value: e.target.value })}
              className="flex-1 font-mono"
            />
            <button
              type="button"
              aria-label="Remove condition"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="rounded-md grid size-8 shrink-0 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { attribute: attributes[0]!.name, op: OPS[attributes[0]!.type][0]!, value: "" },
          ])
        }
        className="flex h-8 w-fit items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" /> Condition
      </button>
    </div>
  );
}
