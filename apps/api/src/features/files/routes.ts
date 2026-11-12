import { files as routes } from "@skywake/contract";
import { blake3, type FileEdit, type FileInfo } from "@skywake/engine";

import { note } from "../../audit/note.ts";
import type { Feature } from "../../http/context.ts";
import { badRequest, messageOf } from "../../http/errors.ts";
import { clamp, pageSize } from "../../http/page.ts";
import { changeable, readable } from "../../http/request.ts";
import { admitsDownload, admitsFiles, downloaded, filesChanged } from "../billing/require.ts";
import { whileWritable } from "../branches/protection.ts";
import * as commits from "../history/commits.ts";
import { assertLiveSession } from "../sessions/rules.ts";
import * as parts from "./parts.ts";

export const PIECE = 4 * 1024 * 1024;

const shown = ({ target, ...info }: FileInfo) =>
  target === undefined ? info : { ...info, target };

const addsData = (change: { text?: string; base64?: string; parts?: string[] }) =>
  change.text !== undefined || change.base64 !== undefined || change.parts !== undefined;

export const filesFeature: Feature = {
  register(api) {
    api.openapi(routes.listFiles, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { path, at, after, limit } = c.req.valid("query");
      const ns = await readable(c, namespace);
      const listing = await ns.engine.list(branch, path, at, after, pageSize(limit));
      return c.json({ ...shown(listing.info), entries: listing.entries.map(shown) }, 200);
    });

    api.openapi(routes.readFile, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { path, offset, length, at } = c.req.valid("query");
      const ns = await readable(c, namespace);
      await admitsDownload(c, ns.org);
      const commit = at ?? (await ns.engine.head(branch));
      const { info } = await ns.engine.list(branch, path, commit);
      const end = info.kind === "file" ? info.size : offset + PIECE;
      const stop = Math.min(end, length === undefined ? end : offset + length);
      const read = (from: number) =>
        ns.engine.read(branch, path, from, Math.max(0, Math.min(PIECE, stop - from)), commit);
      const first = await read(offset);
      downloaded(c, ns.org, first.length);
      let next = offset + first.length;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(first));
          if (first.length === 0 || next >= stop) controller.close();
        },
        async pull(controller) {
          let piece: Buffer;
          try {
            piece = await read(next);
          } catch (error) {
            c.var.services.log({
              level: "error",
              msg: "read failed",
              request_id: c.get("requestId"),
              error: messageOf(error),
            });
            throw error;
          }
          next += piece.length;
          downloaded(c, ns.org, piece.length);
          controller.enqueue(new Uint8Array(piece));
          if (piece.length === 0 || next >= stop) controller.close();
        },
      });
      const headers: Record<string, string> = { "content-type": "application/octet-stream" };
      if (info.kind === "file") headers["content-length"] = String(Math.max(0, stop - offset));
      return c.body(stream, 200, headers);
    });

    api.openapi(routes.searchFiles, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { pattern, path, limit } = c.req.valid("query");
      const ns = await readable(c, namespace);
      return c.json(
        await ns.engine.search(branch, pattern, path, clamp(limit, 100, 1, 10_000)),
        200,
      );
    });

    api.openapi(routes.commitFiles, async (c) => {
      const { namespace, branch } = c.req.valid("param");
      const { message, session, changes } = c.req.valid("json");
      const { caller, ns } = await changeable(c, namespace, "write");
      const { db } = c.var.services;
      await assertLiveSession(db, ns, session);
      if (changes.some(addsData)) await admitsFiles(c, ns.org);
      const uploaded = await parts.chunks(
        db,
        ns,
        changes.flatMap((change) => change.parts ?? []),
      );
      const edits = changes.map((change): FileEdit => {
        const { path, executable, text, base64, from, folder } = change;
        if (text !== undefined) return { path, executable, content: Buffer.from(text) };
        if (base64 !== undefined) {
          return { path, executable, content: Buffer.from(base64, "base64") };
        }
        if (change.parts) {
          const chunks = change.parts.flatMap((part) => {
            const found = uploaded.get(part);
            if (!found) throw badRequest(`upload part ${part} not found`);
            return found;
          });
          return { path, executable, chunks };
        }
        if (from) return { path, from };
        if (folder) return { path, folder };
        return { path };
      });
      const before = await ns.engine.head(branch);
      const head = await whileWritable(db, ns, branch, () =>
        ns.engine.commitFiles(branch, message, edits, session),
      );
      if (head === before) return c.json({ head, changed: false }, 200);
      await filesChanged(c, ns.folder);
      note(c, { details: { head } });
      await commits.record(
        db,
        ns.engine,
        { org: ns.org, namespace: ns.name, name: branch },
        head,
        caller.actor,
        true,
      );
      return c.json({ head, changed: true }, 201);
    });

    api.openapi(routes.uploadPart, async (c) => {
      const { namespace } = c.req.valid("param");
      const { ns } = await changeable(c, namespace, "write");
      await admitsFiles(c, ns.org);
      const bytes = Buffer.from(await c.req.arrayBuffer());
      const part = blake3(bytes).toString("hex");
      await parts.save(c.var.services.db, ns, part, bytes.length, await ns.engine.storePart(bytes));
      await filesChanged(c, ns.folder);
      return c.json({ part, size: bytes.length }, 201);
    });
  },
};
