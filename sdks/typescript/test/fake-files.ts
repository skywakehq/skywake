// A fake of the API's file routes for one branch, kept in memory: enough to
// run checkout, commitFolder and syncIndex against.

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Skywake } from "../dist/index.js";

type Entry = { bytes: Uint8Array; executable: boolean } | { target: string };
type Tree = Map<string, Entry>;
type Changed = { kind: "added" | "removed" | "modified"; path: string };

interface Commit {
  hash: string;
  message: string;
  tree: Tree;
  changes: Changed[];
}

export interface FakeFiles {
  sky: Skywake;
  commits: Commit[];
  /** The size of each commit's body, as sent. */
  bodies: number[];
  /** Documents of the fake index, by id. */
  documents: Map<string | number, any>;
  /** Applies `changes` as a commit, as the API would, and returns its hash. */
  commit(changes: any[], message?: string): string;
  close(): Promise<unknown>;
}

const enc = new TextEncoder();

export async function fakeFiles(): Promise<FakeFiles> {
  const commits: Commit[] = [{ hash: "c0", message: "start", tree: new Map(), changes: [] }];
  const parts = new Map<string, Uint8Array>();
  const bodies: number[] = [];
  const documents = new Map<string | number, any>();

  const treeAt = (at: string | null) =>
    at ? commits.find((commit) => commit.hash === at)?.tree : commits.at(-1)!.tree;

  const commit = (changes: any[], message = "change") => {
    const before = commits.at(-1)!.tree;
    const tree: Tree = new Map(before);
    const changed: Changed[] = [];
    for (const change of changes) {
      if (change.delete) {
        const under = [...tree.keys()].filter(
          (path) => path === change.path || path.startsWith(`${change.path}/`),
        );
        for (const path of under) tree.delete(path);
        // As the API does, a removed folder is one change.
        if (under.length > 0) changed.push({ kind: "removed", path: change.path });
        continue;
      }
      const bytes =
        change.text !== undefined
          ? enc.encode(change.text)
          : change.base64 !== undefined
            ? Uint8Array.from(atob(change.base64), (c) => c.charCodeAt(0))
            : Buffer.concat(change.parts.map((part: string) => parts.get(part)!));
      changed.push({ kind: tree.has(change.path) ? "modified" : "added", path: change.path });
      tree.set(change.path, { bytes, executable: change.executable ?? false });
    }
    const hash = `c${commits.length}`;
    commits.push({ hash, message, tree, changes: changed });
    return hash;
  };

  const handle = (request: IncomingMessage, body: Buffer, response: ServerResponse) => {
    const url = new URL(request.url!, "http://x");
    const query = url.searchParams;
    const route = url.pathname.replace("/v1/namespaces/app", "");
    const send = (status: number, reply: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply));
    };
    const missing = () => send(404, { error: "no", code: "not_found", request_id: null });

    if (route === "/uploads") {
      const part = createHash("sha256").update(body).digest("hex");
      parts.set(part, new Uint8Array(body));
      return send(201, { part, size: body.length });
    }
    if (route === "/branches/main") {
      const head = commits.at(-1)!.hash;
      return send(200, { name: "main", forked_from: null, protected: false, created: "", head });
    }
    if (route === "/branches/main/commits") {
      bodies.push(body.length);
      const { message, changes } = JSON.parse(body.toString());
      if (changes.length > 10_000) return send(400, { error: "too many", code: "invalid" });
      return send(201, { head: commit(changes, message), changed: true });
    }
    if (route === "/branches/main/changes") {
      // Like the API: the newest `limit` commits, cut at `since` if it is among them.
      const limit = Number(query.get("limit") ?? 50);
      let log = commits.slice(1).slice(-limit);
      const seen = log.findIndex((commit) => commit.hash === query.get("since"));
      if (seen >= 0) log = log.slice(seen + 1);
      return send(
        200,
        log.map(({ hash, message, changes }) => ({
          hash,
          message,
          time: 0,
          session: null,
          merged: null,
          changes,
        })),
      );
    }
    const tree = treeAt(query.get("at"));
    if (!tree) return missing();
    const path = query.get("path") ?? "";
    if (route === "/branches/main/files/content") {
      const entry = tree.get(path);
      if (!entry || !("bytes" in entry)) return missing();
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": entry.bytes.length,
      });
      return response.end(entry.bytes);
    }
    if (route === "/branches/main/files") {
      const info = (name: string, entry: Entry | undefined) => ({
        name,
        kind: !entry ? "folder" : "target" in entry ? "symlink" : "file",
        size: entry && "bytes" in entry ? entry.bytes.length : 0,
        executable: entry && "bytes" in entry ? entry.executable : false,
        ...(entry && "target" in entry ? { target: entry.target } : {}),
        modified: 0,
      });
      const entry = tree.get(path);
      if (entry) return send(200, { ...info(path, entry), entries: [] });
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, Entry | undefined>();
      for (const [full, entry] of tree) {
        if (!full.startsWith(prefix)) continue;
        const [name, ...rest] = full.slice(prefix.length).split("/");
        names.set(name!, rest.length > 0 ? undefined : entry);
      }
      if (path && names.size === 0) return missing();
      const after = query.get("after");
      const page = [...names.keys()]
        .sort()
        .filter((name) => !after || name > after)
        .slice(0, Number(query.get("limit") ?? 1000));
      return send(200, {
        ...info(path, undefined),
        entries: page.map((name) => info(name, names.get(name))),
      });
    }

    const index = url.pathname.match(/^\/v1\/indexes\/docs\/branches\/main\/documents(\/delete)?$/);
    if (index) {
      const sent = JSON.parse(body.toString());
      if (index[1]) {
        const count = sent.ids.filter((id: string) => documents.delete(id)).length;
        return send(200, { count });
      }
      for (const document of sent.documents) documents.set(document.id, document);
      return send(200, { count: sent.documents.length });
    }
    send(404, { error: `no route ${url.pathname}`, code: "not_found" });
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => handle(request, Buffer.concat(chunks), response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    sky: new Skywake({ url: `http://127.0.0.1:${port}`, key: "k", backoffMs: 1 }),
    commits,
    bodies,
    documents,
    commit,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
