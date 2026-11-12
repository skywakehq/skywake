import type { Client, Schemas } from "../core/api.js";
import { unwrap } from "../core/errors.js";
import { everything, type Page } from "../core/paging.js";
import {
  checkout,
  commitFolder,
  type CheckoutOptions,
  type CommitFolderOptions,
} from "./folders.js";
import type { MergeOptions, Namespace } from "./namespace.js";

export type FileChange = Schemas["FileChange"];

/** A file, folder or symlink, with its full path from the root of the branch. */
export type TreeEntry = Schemas["FileInfo"] & { path: string };

/** Read an older commit of the branch instead of its head. */
export interface At {
  at?: string;
}

/** A byte range of a file: `length` bytes from `offset`, at an older commit if `at` is set. */
export interface ReadRange extends At {
  offset?: number;
  length?: number;
}

/** The new commit's message, and the session making it. */
export interface CommitOptions {
  message?: string;
  session?: string;
}

/**
 * `head` compares with `from` as it is now. `base` compares with the newest
 * commit both branches share, so only what this branch changed shows.
 */
export interface DiffOptions {
  against?: "head" | "base";
}

export class Branch {
  constructor(
    readonly namespace: Namespace,
    readonly name: string,
  ) {}

  private get client(): Client {
    return this.namespace.client;
  }

  private get path() {
    return { namespace: this.namespace.name, branch: this.name };
  }

  /** Forks this branch as `name`, at its head or at an older commit `at`. No data is copied. */
  async fork(name: string, at?: string): Promise<Branch> {
    unwrap(
      await this.client.POST("/namespaces/{namespace}/branches", {
        params: { path: { namespace: this.namespace.name } },
        body: { name, from: this.name, at },
      }),
    );
    return this.namespace.branch(name);
  }

  async info(): Promise<Schemas["BranchInfo"]> {
    const params = { path: this.path };
    return unwrap(await this.client.GET("/namespaces/{namespace}/branches/{branch}", { params }));
  }

  async delete(): Promise<void> {
    const params = { path: this.path };
    unwrap(await this.client.DELETE("/namespaces/{namespace}/branches/{branch}", { params }));
  }

  /** A protected branch changes only by merge. Needs an admin key. */
  async protect(protect = true): Promise<void> {
    const params = { path: this.path };
    const body = { protected: protect };
    unwrap(await this.client.PATCH("/namespaces/{namespace}/branches/{branch}", { params, body }));
  }

  /** Describes a path. For a folder, also lists one page of what it holds. */
  async list(path = "", page: Page & At = {}): Promise<Schemas["Listing"]> {
    const params = { path: this.path, query: { path, ...page } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/files", { params }),
    );
  }

  /** Everything a folder holds, a page at a time. */
  allEntries(path = "", options: At = {}): AsyncGenerator<Schemas["FileInfo"], void, undefined> {
    return everything(
      async (page) => (await this.list(path, { ...page, ...options })).entries,
      (entry) => entry.name,
    );
  }

  /** Everything under a folder at any depth, each folder before what it holds. */
  async *walk(folder = "", options: At = {}): AsyncGenerator<TreeEntry, void, undefined> {
    for await (const entry of this.allEntries(folder, options)) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      yield { ...entry, path };
      if (entry.kind === "folder") yield* this.walk(path, options);
    }
  }

  /**
   * Node only. Writes the branch, at its head or at `options.at`, into the local
   * folder `dir`, and returns the commit it wrote. Files already in `dir` stay
   * unless the branch has a file at the same path.
   */
  async checkout(dir: string, options: CheckoutOptions = {}): Promise<string> {
    return checkout(this, dir, options);
  }

  /**
   * Node only. Commits every file under the local folder `dir`, leaving out
   * `.git`, symlinks and empty folders, and returns the new head. A folder over
   * the API's limits for one commit lands as several, each with `message`.
   */
  async commitFolder(dir: string, options: CommitFolderOptions): Promise<string> {
    return commitFolder(this, dir, options);
  }

  /** Reads a file, or `length` bytes of it from `offset`. */
  async read(path: string, range: ReadRange = {}): Promise<Uint8Array> {
    const answer = await content(this.client, this.path, { path, ...range }, "arrayBuffer");
    return new Uint8Array(answer as ArrayBuffer);
  }

  /** Like `read`, but as a stream, so a large file need not fit in memory. */
  async readStream(path: string, range: ReadRange = {}): Promise<ReadableStream<Uint8Array>> {
    const answer = await content(this.client, this.path, { path, ...range }, "stream");
    // An empty file's answer has no body.
    return (answer as ReadableStream<Uint8Array> | undefined) ?? new Blob().stream();
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  /** Finds lines that match a regular expression, like `grep -rn`. */
  async search(
    pattern: string,
    options: { path?: string; limit?: number } = {},
  ): Promise<Schemas["Match"][]> {
    const params = { path: this.path, query: { pattern, ...options } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/search", { params }),
    );
  }

  /** Applies `changes` as one commit. Returns the new head. */
  async commit(message: string, changes: FileChange[], session?: string): Promise<string> {
    const answer = await this.client.POST("/namespaces/{namespace}/branches/{branch}/commits", {
      params: { path: this.path },
      body: { message, changes, session },
    });
    return unwrap(answer).head;
  }

  /** Writes text files, as one commit. */
  async write(files: Record<string, string>, message: string, session?: string): Promise<string> {
    const changes = Object.entries(files).map(([path, text]) => ({ path, text }));
    return this.commit(message, changes, session);
  }

  async log(limit?: number): Promise<Schemas["CommitInfo"][]> {
    const params = { path: this.path, query: { limit } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/commits", { params }),
    );
  }

  /** One page of the versions of one file, newest first. */
  async history(path: string, page: Page = {}): Promise<Schemas["FileVersion"][]> {
    const params = { path: this.path, query: { path, ...page } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/files/history", { params }),
    );
  }

  /** Every version of one file, a page at a time. */
  allHistory(path: string): AsyncGenerator<Schemas["FileVersion"], void, undefined> {
    return everything(
      (page) => this.history(path, page),
      (version) => version.hash,
    );
  }

  /** What each commit after `since` changed, oldest first. */
  async changes(since?: string, limit?: number): Promise<Schemas["FeedItem"][]> {
    const params = { path: this.path, query: { since, limit } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/changes", { params }),
    );
  }

  /** One page of what changed from the branch `from` to this one, in path order. */
  async diff(from: string, page: Page & DiffOptions = {}): Promise<Schemas["Changed"][]> {
    const params = { path: this.path, query: { from, ...page } };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/diff", { params }),
    );
  }

  /** Everything that changed from the branch `from` to this one, a page at a time. */
  allDiff(
    from: string,
    options: DiffOptions = {},
  ): AsyncGenerator<Schemas["Changed"], void, undefined> {
    return everything(
      (page) => this.diff(from, { ...page, ...options }),
      (change) => change.path,
    );
  }

  /**
   * Undoes one commit with a new commit that puts back what it changed. If the
   * branch changed any of those paths since, it throws a `SkywakeError` with
   * status 409 whose `conflicts` lists them, and nothing is saved.
   */
  async revert(commit: string, options: CommitOptions = {}): Promise<Schemas["Committed"]> {
    const answer = await this.client.POST("/namespaces/{namespace}/branches/{branch}/revert", {
      params: { path: this.path },
      body: { commit, ...options },
    });
    return unwrap(answer);
  }

  /** Makes the branch's files what they were at commit `to`, as one new commit on top. */
  async reset(to: string, options: CommitOptions = {}): Promise<Schemas["Committed"]> {
    const answer = await this.client.POST("/namespaces/{namespace}/branches/{branch}/reset", {
      params: { path: this.path },
      body: { to, ...options },
    });
    return unwrap(answer);
  }

  /** Merges this branch into `into`. */
  async mergeInto(into: string, options: MergeOptions = {}) {
    return this.namespace.merge(this.name, into, options);
  }

  /** Claims a path for a session. Resolves `false` if someone else holds it. */
  async claim(path: string, session: string): Promise<boolean> {
    const answer = await this.client.POST("/namespaces/{namespace}/branches/{branch}/claims", {
      params: { path: this.path },
      body: { path, session },
    });
    if (answer.response.status === 409) {
      return false;
    }
    unwrap(answer);
    return true;
  }

  /** One page of the paths claimed by live sessions. */
  async claims(page: Page = {}): Promise<Schemas["Claim"][]> {
    const params = { path: this.path, query: page };
    return unwrap(
      await this.client.GET("/namespaces/{namespace}/branches/{branch}/claims", { params }),
    );
  }

  /** Every claimed path, a page at a time. */
  allClaims(): AsyncGenerator<Schemas["Claim"], void, undefined> {
    return everything(
      (page) => this.claims(page),
      (claim) => claim.path,
    );
  }

  async release(path: string, session: string): Promise<void> {
    const params = { path: this.path, query: { path, session } };
    unwrap(
      await this.client.DELETE("/namespaces/{namespace}/branches/{branch}/claims", { params }),
    );
  }
}

/** The bytes of a file, whole or in `query`'s range, as a buffer or a stream. */
async function content(
  client: Client,
  branch: { namespace: string; branch: string },
  query: { path: string } & ReadRange,
  parseAs: "arrayBuffer" | "stream",
): Promise<unknown> {
  return unwrap(
    await client.GET("/namespaces/{namespace}/branches/{branch}/files/content", {
      params: { path: branch, query },
      parseAs,
    }),
  );
}
