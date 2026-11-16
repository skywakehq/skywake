import { v2 } from "@skywake/contract";

import * as links from "../features/links/queries.ts";
import type { V2, V2Ctx } from "./app.ts";
import { Failure, invalid } from "./errors.ts";
import { segment } from "./forward.ts";
import { branchOf } from "./indexes.ts";
import { pageAfter, pageOf, whole } from "./pages.ts";
import { orMissing, type Scope } from "./scope.ts";

const routes = v2.disks;
const MAIN = "main";
const SNIPPET = 300;

type Namespace = {
  name: string;
  region: string;
  visibility: "private" | "public";
  created: string;
};
type Branch = { name: string; forked_from: string | null; created: string };
type Committed = { head: string; changed: boolean };
type Entry = { name: string; kind: "file" | "folder" | "symlink"; size: number; modified: number };
type Link = { index: string; embed: { model: string } | null };
type Hit = {
  id: string | number;
  score?: number;
  distance?: number;
  attributes: { path?: string; text?: string; summary?: string };
  highlights?: Record<string, { text: string }>;
};

const join = (folder: string, name: string) =>
  folder ? `${folder.replace(/\/$/, "")}/${name}` : name;
const committed = (done: Committed) => ({ commit: done.head, changed: done.changed });
const isoOf = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null);

export class Disks {
  readonly scope: Scope;
  readonly name: string;

  constructor(scope: Scope, name: string) {
    this.scope = scope;
    this.name = name;
  }

  get path() {
    return this.scope.path("disk", this.name);
  }

  get indexName() {
    return `${this.scope.full(this.name)}.files`;
  }

  branch(branch = MAIN) {
    return `${this.path}/branches/${segment(branch)}`;
  }

  run<T>(work: Promise<T>) {
    return orMissing(this.scope, "disk", this.name, work);
  }

  async link(): Promise<Link | null> {
    try {
      return await this.scope.v1.get<Link>(`${this.path}/index`);
    } catch (error) {
      if (error instanceof Failure && error.status === 404) return null;
      throw error;
    }
  }

  async info() {
    const disk = await this.run(this.scope.v1.get<Namespace>(this.path));
    const [branches, link] = await Promise.all([
      this.scope.v1.get<Branch[]>(`${this.path}/branches`),
      this.link(),
    ]);
    return {
      ...disk,
      name: this.name,
      search: link !== null,
      branches: branches.map((b) => b.name),
    };
  }

  async create(asked: { region?: string; visibility?: "private" | "public"; search?: boolean }) {
    await this.scope.notTaken("disk", this.name);
    await this.scope.v1.post("/namespaces", {
      name: this.scope.full(this.name),
      region: asked.region,
      visibility: asked.visibility,
    });
    await this.scope.v1.post(`${this.path}/branches`, { name: MAIN });
    const search = asked.search ?? this.scope.c.var.services.models.linkModel !== undefined;
    if (search) await this.search(true);
  }

  async search(on: boolean) {
    if (on) {
      await this.scope.v1.put(`${this.path}/index`, { index: this.indexName });
      return;
    }
    const link = await links.find(
      this.scope.c.var.services.db,
      this.scope.org,
      this.scope.full(this.name),
    );
    if (!link) return;
    await this.scope.v1.delete(`${this.path}/index`);
    if (link.made) await this.scope.v1.delete(`/indexes/${segment(link.index)}`);
  }

  async destroy() {
    const link = await links.find(
      this.scope.c.var.services.db,
      this.scope.org,
      this.scope.full(this.name),
    );
    await this.run(this.scope.v1.delete(this.path));
    if (link?.made) {
      await this.scope.v1.delete(`/indexes/${segment(link.index)}`).catch((error: unknown) => {
        if (!(error instanceof Failure && error.status === 404)) throw error;
      });
    }
  }

  async commit(changes: unknown[], message: string | undefined, branch = MAIN) {
    const body = { message: message ?? describe(changes), changes };
    const send = () => this.scope.v1.post<Committed>(`${this.branch(branch)}/commits`, body);
    return committed(await this.orMake(send, branch));
  }

  async orMake<T>(work: () => Promise<T>, branch = MAIN): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof Failure && error.status === 404)) throw error;
      if (await this.scope.exists("disk", this.name)) throw error;
      if (branch !== MAIN) throw await this.scope.notFound("disk", this.name);
      await this.create({}).catch((error: unknown) => {
        if (
          !(error instanceof Failure && error.status === 409 && error.details.hint === undefined)
        ) {
          throw error;
        }
      });
      return work();
    }
  }
}

function describe(changes: unknown[]) {
  const paths = changes.map((change) => (change as { path: string }).path);
  return paths.length === 1 ? `Change ${paths[0]}` : `Change ${paths.length} files`;
}

const pathOf = (c: V2Ctx) => {
  const prefix = `/disks/${c.req.param("disk")}/files/`;
  const at = c.req.path.indexOf(prefix);
  const raw = at < 0 ? "" : c.req.path.slice(at + prefix.length);
  const path = decodeURIComponent(raw);
  if (!path) throw invalid("is empty", "path", "name a file, such as `src/main.rs`");
  return path;
};

export function registerDisks(api: V2) {
  const open = async (c: V2Ctx, name: string) => new Disks(await c.var.scope(), name);

  api.openapi(routes.listDisks, async (c) => {
    const scope = await c.var.scope();
    const all = await scope.v1.get<Namespace[]>("/namespaces");
    const mine = all.flatMap((ns) => {
      const name = scope.mine(ns.name);
      return name === null ? [] : [{ ...ns, name }];
    });
    return c.json(
      pageOf(mine, (disk) => disk.name, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.createDisk, async (c) => {
    const { name, ...asked } = c.req.valid("json");
    const disk = await open(c, name);
    await disk.create(asked);
    return c.json(await disk.info(), 201);
  });

  api.openapi(routes.getDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    return c.json(await disk.info(), 200);
  });

  api.openapi(routes.configureDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { visibility, search } = c.req.valid("json");
    if (visibility) await disk.run(disk.scope.v1.patch(disk.path, { visibility }));
    if (search !== undefined) await disk.run(disk.search(search));
    return c.json(await disk.info(), 200);
  });

  api.openapi(routes.destroyDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    await disk.destroy();
    return c.body(null, 204);
  });

  api.openapi(routes.listFiles, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { path = "", recursive, branch, at, limit, cursor } = c.req.valid("query");
    const size = limit ?? 100;
    if (recursive === "true") {
      const found = await disk.run(
        disk.scope.v1.get<{ path: string; kind: "file" | "folder" | "symlink"; size: number }[]>(
          `${disk.branch(branch)}/find`,
          { glob: "**", path, at, limit: 100_000 },
        ),
      );
      const entries = found.map((f) => ({ ...f, modified: null }));
      return c.json(
        pageOf(entries, (e) => e.path, { limit: size, cursor }),
        200,
      );
    }
    const listing = await disk.run(
      disk.scope.v1.get<{ entries: Entry[] }>(`${disk.branch(branch)}/files`, {
        path,
        at,
        limit: size,
        after: cursor,
      }),
    );
    const page = pageAfter(listing.entries, size, (e) => e.name);
    return c.json(
      {
        data: page.data.map((e) => ({
          path: join(path, e.name),
          kind: e.kind,
          size: e.size,
          modified: isoOf(e.modified),
        })),
        next: page.next,
      },
      200,
    );
  });

  api.get("/disks/:disk/files/:path{.+}", async (c) => {
    const disk = await open(c, c.req.param("disk"));
    const query = c.req.query();
    const response = await disk.scope.v1.raw("GET", `${disk.branch(query.branch)}/files/content`, {
      query: { path: pathOf(c), offset: query.offset, length: query.length, at: query.at },
    });
    if (!response.ok) {
      const failure = Failure.from(
        response.status,
        await response.json().catch(() => null),
        response.headers,
      );
      if (failure.status === 404 && !(await disk.scope.exists("disk", disk.name))) {
        throw await disk.scope.notFound("disk", disk.name);
      }
      throw failure;
    }
    return new Response(response.body, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  });

  api.put("/disks/:disk/files/:path{.+}", async (c) => {
    const disk = await open(c, c.req.param("disk"));
    const bytes = Buffer.from(await c.req.arrayBuffer());
    const change = { path: pathOf(c), base64: bytes.toString("base64") };
    return c.json(await disk.commit([change], c.req.query("message"), c.req.query("branch")), 200);
  });

  api.delete("/disks/:disk/files/:path{.+}", async (c) => {
    const disk = await open(c, c.req.param("disk"));
    const change = { path: pathOf(c), delete: true };
    return c.json(
      await disk.run(disk.commit([change], c.req.query("message"), c.req.query("branch"))),
      200,
    );
  });

  api.openapi(routes.commit, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { changes, message, branch } = c.req.valid("json");
    return c.json(await disk.commit(changes, message, branch), 200);
  });

  api.openapi(routes.log, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { path, branch, limit, cursor } = c.req.valid("query");
    const size = limit ?? 50;
    type Info = { hash: string; message: string; time: number; merged: string | null };
    const commits = path
      ? await disk.run(
          disk.scope.v1.get<Info[]>(`${disk.branch(branch)}/files/history`, {
            path,
            limit: size,
            after: cursor,
          }),
        )
      : await disk.run(
          disk.scope.v1.get<Info[]>(`${disk.branch(branch)}/commits`, { limit: size }),
        );
    const data = commits.map((commit) => ({
      id: commit.hash,
      message: commit.message,
      created: new Date(commit.time * 1000).toISOString(),
      merged: commit.merged,
    }));
    return c.json(path ? pageAfter(data, size, (d) => d.id) : whole(data), 200);
  });

  api.openapi(routes.diff, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { against, branch, limit, cursor } = c.req.valid("query");
    const size = limit ?? 1000;
    const changes = await disk.run(
      disk.scope.v1.get<{ kind: "added" | "removed" | "modified"; path: string }[]>(
        `${disk.branch(branch)}/diff`,
        { from: against, limit: size, after: cursor },
      ),
    );
    const data = changes.map((change) => ({ path: change.path, change: change.kind }));
    return c.json(
      pageAfter(data, size, (d) => d.path),
      200,
    );
  });

  api.openapi(routes.grep, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { pattern, path, glob, ignore_case, limit, branch, at } = c.req.valid("json");
    const matches = await disk.run(
      disk.scope.v1.get<{ path: string; line: number; text: string }[]>(
        `${disk.branch(branch)}/search`,
        {
          pattern,
          path,
          glob,
          ignoreCase: ignore_case,
          limit,
          at,
        },
      ),
    );
    return c.json(whole(matches), 200);
  });

  api.openapi(routes.find, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { glob, path, kind, limit, branch, at } = c.req.valid("json");
    const found = await disk.run(
      disk.scope.v1.get<{ path: string; kind: "file" | "folder" | "symlink"; size: number }[]>(
        `${disk.branch(branch)}/find`,
        { glob, path, kind, limit, at },
      ),
    );
    return c.json(whole(found), 200);
  });

  api.openapi(routes.queryDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { text, limit = 10, path, branch } = c.req.valid("json");
    const link = await disk.link();
    if (!link) {
      await disk.run(disk.scope.v1.get(disk.path));
      throw new Failure(409, `search is off for disk \`${disk.name}\``, {
        hint: `turn it on: PATCH /v2/disks/${disk.name} with {"search": true}`,
      });
    }
    const index = `/indexes/${segment(link.index)}/branches/${segment(branch ?? MAIN)}`;
    const filter = path ? { path: { glob: `${path.replace(/\/$/, "")}/**` } } : undefined;
    const words = { query: text, fields: ["text"], filter, highlight: ["text"] };
    const per = { attributes: ["path"], limit: 1 };
    const include = ["path", "summary"];
    const { hits } = link.embed
      ? await disk.scope.v1.post<{ hits: Hit[] }>(`${index}/hybrid`, {
          searches: {
            meaning: { vector: { column: "embedding", value: text }, filter, topK: 50, include },
            words: { ...words, topK: 50, include },
          },
          topK: limit,
          per,
        })
      : await disk.scope.v1.post<{ hits: Hit[] }>(`${index}/search`, {
          ...words,
          topK: limit,
          per,
          include,
        });
    const data = hits.map((hit) => ({
      path: hit.attributes.path ?? String(hit.id),
      score: hit.score ?? 0,
      snippet: (hit.highlights?.text?.text ?? hit.attributes.summary ?? "").slice(0, SNIPPET),
    }));
    return c.json(whole(data), 200);
  });

  api.openapi(routes.revert, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { commit, message, branch } = c.req.valid("json");
    const done = await disk.run(
      disk.scope.v1.post<Committed>(`${disk.branch(branch)}/revert`, { commit, message }),
    );
    return c.json(committed(done), 200);
  });

  api.openapi(routes.restoreDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { to, branch } = c.req.valid("json");
    const done = await disk.run(
      disk.scope.v1.post<Committed>(`${disk.branch(branch)}/reset`, { to }),
    );
    return c.json(committed(done), 200);
  });

  api.post("/disks/:disk/uploads", async (c) => {
    const disk = await open(c, c.req.param("disk"));
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const part = await disk.orMake(() =>
      disk.scope.v1.send("POST", `${disk.path}/uploads`, { bytes }).then((r) => r.body),
    );
    return c.json(part as { part: string; size: number }, 201);
  });

  api.openapi(routes.listDiskBranches, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const all = await disk.run(disk.scope.v1.get<Branch[]>(`${disk.path}/branches`));
    return c.json(
      pageOf(all.map(branchOf), (b) => b.name, c.req.valid("query")),
      200,
    );
  });

  api.openapi(routes.forkDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { name, from, at } = c.req.valid("json");
    const linked = (await disk.link()) !== null;
    await disk.run(
      disk.scope.v1.post(`${disk.path}/branches`, {
        name,
        from: from ?? MAIN,
        at,
        withIndex: linked || undefined,
      }),
    );
    return c.json(branchOf(await disk.scope.v1.get<Branch>(disk.branch(name))), 201);
  });

  api.openapi(routes.destroyDiskBranch, async (c) => {
    const { disk: name, branch } = c.req.valid("param");
    const disk = await open(c, name);
    await disk.run(disk.scope.v1.delete(disk.branch(branch)));
    return c.body(null, 204);
  });

  api.openapi(routes.mergeDisk, async (c) => {
    const disk = await open(c, c.req.valid("param").disk);
    const { from, into, message, dry_run, prefer } = c.req.valid("json");
    const merge = (resolve?: { path: string; take: "ours" | "theirs" }[]) =>
      disk.run(
        disk.scope.v1.post<{ head: string | null; conflicts: string[] }>(`${disk.path}/merges`, {
          from,
          into: into ?? MAIN,
          message,
          dry_run,
          resolve,
        }),
      );
    try {
      const done = await merge();
      return c.json({ commit: done.head, conflicts: done.conflicts }, 200);
    } catch (error) {
      const conflicts = error instanceof Failure ? error.details.conflicts : undefined;
      if (!prefer || !conflicts?.length) throw error;
      const done = await merge(conflicts.map((path) => ({ path, take: prefer })));
      return c.json({ commit: done.head, conflicts: done.conflicts }, 200);
    }
  });
}
