import type { Engine, FileEdit } from "@skywake/engine";

const trimmed = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** Whether settling `picked` settles `path` too: the same path, or a folder holding it. */
export function covers(picked: string, path: string) {
  [picked, path] = [trimmed(picked), trimmed(path)];
  return path === picked || path.startsWith(`${picked}/`);
}

const overlaps = (a: string, b: string) => covers(a, b) || covers(b, a);

/**
 * The edits that put back what `hash` changed, against the branch as it is at
 * `head`. A path the branch changed again since is a conflict, not an edit, so
 * no later work is lost.
 */
export async function revertEdits(engine: Engine, head: string, hash: string) {
  const { commit, changes } = await engine.commit(hash);
  const since = await engine.diffCommits(hash, head);
  const conflicts = changes
    .map((change) => change.path)
    .filter((path) => since.some((change) => overlaps(change.path, path)));
  const parent = commit.parent;
  const edits = changes.map(({ kind, path }): FileEdit =>
    kind === "added" || !parent ? { path } : { path, from: { path, at: parent } },
  );
  return { commit, edits, conflicts };
}

/** The edits that make the files at `head` what they were at `to`. */
export async function resetEdits(engine: Engine, head: string, to: string) {
  const changes = await engine.diffCommits(to, head);
  return changes.map(({ kind, path }): FileEdit =>
    kind === "added" ? { path } : { path, from: { path, at: to } },
  );
}
