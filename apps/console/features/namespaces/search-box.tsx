"use client";

import { Search as SearchIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, Panel } from "@/components/kit";
import { Link } from "@/components/shell/router";
import { Select, TextField } from "@/features/indexes/fields";
import { branchPath } from "@/lib/paths";
import { diskApi, v2 } from "@/lib/v2";

type Hit = { path: string; score: number; snippet: string };

type Found =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; hits: Hit[] }
  | { state: "failed"; error: string };

export function SearchBox({ ns, branches }: { ns: string; branches: string[] }) {
  const [text, setText] = useState("");
  const [branch, setBranch] = useState("main");
  const [found, setFound] = useState<Found>({ state: "idle" });

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setFound({ state: "busy" });
    try {
      const [env, path] = diskApi(ns, "query");
      const { data } = await v2<{ data: Hit[] }>(env, "POST", path, {
        text: text.trim(),
        branch,
        limit: 20,
      });
      setFound({ state: "done", hits: data });
    } catch (failure) {
      setFound({
        state: "failed",
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }

  return (
    <Panel title="Search">
      <form onSubmit={search} className="flex flex-wrap gap-2 px-4 py-4">
        <TextField
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask in words, or type the words you remember"
          className="min-w-0 flex-1"
          aria-label="Search text"
          autoFocus
        />
        {branches.length > 1 && (
          <Select
            aria-label="Branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="text-xs"
          >
            {branches.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        )}
        <Button
          type="submit"
          variant="primary"
          size="default"
          leadingIcon={SearchIcon}
          disabled={found.state === "busy" || !text.trim()}
        >
          Search
        </Button>
      </form>
      <Results ns={ns} branch={branch} found={found} />
    </Panel>
  );
}

function Results({ ns, branch, found }: { ns: string; branch: string; found: Found }) {
  if (found.state === "idle" || found.state === "busy") return null;
  if (found.state === "failed") return <p className="px-4 pb-4 text-sm text-red">{found.error}</p>;
  if (!found.hits.length)
    return <p className="px-4 pb-4 text-sm text-muted-foreground">No files match.</p>;
  return (
    <ul className="divide-y divide-border/60 border-t border-border/60">
      {found.hits.map((hit) => (
        <li key={hit.path} className="grid gap-1 px-4 py-3">
          <Link
            href={branchPath(ns, branch, { tab: "files", path: hit.path })}
            className="truncate font-mono text-sm hover:underline"
          >
            {hit.path}
          </Link>
          {hit.snippet && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
