"use client";

import { Search as SearchIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/kit";
import { FileIcon } from "@/features/files/file-icon";
import { Link } from "@/components/shell/router";
import { Select } from "@/components/fields";
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
    <div className="grid gap-4">
      <form
        onSubmit={search}
        className="flex h-12 items-center gap-3 rounded-full bg-hover pr-1.5 pl-5 transition-colors focus-within:bg-active"
      >
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask in words, or type the words you remember"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
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
          disabled={found.state === "busy" || !text.trim()}
        >
          Search
        </Button>
      </form>
      <Results ns={ns} branch={branch} found={found} />
    </div>
  );
}

function Results({ ns, branch, found }: { ns: string; branch: string; found: Found }) {
  if (found.state === "idle" || found.state === "busy") return null;
  if (found.state === "failed") return <p className="px-5 text-sm text-red">{found.error}</p>;
  if (!found.hits.length)
    return <p className="px-5 text-sm text-muted-foreground">No files match.</p>;
  return (
    <ul className="grid gap-1">
      {found.hits.map((hit) => (
        <li key={hit.path}>
          <Link
            href={branchPath(ns, branch, { tab: "files", path: hit.path })}
            className="flex gap-3 rounded-2xl px-5 py-3 transition-colors hover:bg-hover"
          >
            <FileIcon name={hit.path} className="mt-0.5 size-4 shrink-0" />
            <span className="grid min-w-0 gap-1">
              <span className="truncate text-sm font-medium">{hit.path}</span>
              {hit.snippet && (
                <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
