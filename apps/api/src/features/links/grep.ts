import type { IndexFilter, SearchMatch } from "@skywake/engine";

import type { Namespace } from "../../auth/access.ts";
import type { Services } from "../../http/context.ts";
import * as indexes from "../indexes/queries.ts";
import { neededGrams } from "./grams.ts";
import * as links from "./queries.ts";
import { literal } from "./writer.ts";

const PAGE = 1_000;
const CANDIDATES_MAX = 10_000;
const CHANGED_MAX = 5_000;

export interface GrepAsked {
  pattern: string;
  folder: string;
  glob?: string;
  ignoreCase: boolean;
  at?: string;
  limit: number;
}

export interface Grepped {
  matches: SearchMatch[];
  partial: boolean;
}

type Index = ReturnType<Services["stores"]["index"]>;

interface Candidates {
  paths: Set<string>;
  partial: boolean;
}

export async function grepIndexed(
  services: Pick<Services, "db" | "stores">,
  ns: Namespace,
  branch: string,
  asked: GrepAsked,
): Promise<Grepped | null> {
  const { db, stores } = services;
  const link = await links.find(db, ns.org, ns.name);
  if (!link) return null;
  const linked = await links.branch(db, ns.org, ns.name, branch);
  if (!linked?.synced) return null;
  const row = await indexes.find(db, ns.org, link.index);
  if (!row?.schema.attributes.some((column) => column.name === "grams")) return null;
  const needs = neededGrams(asked.pattern);
  if (!needs) return null;

  const head = asked.at ?? (await ns.engine.head(branch));
  const changed = head === linked.synced ? [] : await ns.engine.diffCommits(linked.synced, head);
  if (changed.length > CHANGED_MAX) return null;

  await stores.ready(row.region);
  const index = stores.index(row.region, row.folder, indexes.openOptions(row));
  const folder = asked.folder.replace(/^\/+|\/+$/g, "");
  const found = await candidates(index, branch, folder, needs);
  for (const change of changed) found.paths.add(change.path);

  const matches = await ns.engine.grep(branch, asked.pattern, {
    folder,
    glob: asked.glob,
    ignoreCase: asked.ignoreCase,
    only: [...found.paths],
    limit: asked.limit,
    at: head,
  });
  return { matches, partial: found.partial && matches.length < asked.limit };
}

async function candidates(
  index: Index,
  branch: string,
  folder: string,
  needs: string[][],
): Promise<Candidates> {
  const found: Candidates = { paths: new Set(), partial: false };
  for (const grams of needs) {
    const tokens = grams.join(" ");
    const filter = gramFilter(tokens, folder);
    for (let offset = 0; ; offset += PAGE) {
      const hits = await index.search(branch, {
        query: tokens,
        fields: ["grams"],
        topK: PAGE,
        offset,
        filter,
        include: ["path"],
      });
      for (const hit of hits) {
        const path = hit.attributes.path;
        if (typeof path === "string") found.paths.add(path);
      }
      if (hits.length < PAGE) break;
      if (offset + PAGE >= CANDIDATES_MAX) {
        found.partial = true;
        break;
      }
    }
  }
  return found;
}

function gramFilter(tokens: string, folder: string): IndexFilter {
  const parts: IndexFilter[] = [{ grams: { contains_all_tokens: tokens } }];
  if (folder) parts.push({ path: { glob: `${literal(folder)}/*` } });
  return { and: parts };
}
