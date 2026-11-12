import type { Client, Schemas } from "../core/api.js";
import { unwrap } from "../core/errors.js";
import { everything, type Page } from "../core/paging.js";
import { Branch } from "./branch.js";
import { Session } from "./session.js";

export interface MergeOptions {
  message?: string;
  /** The session doing the merge. The merge commit records it. */
  session?: string;
  /** Only report the conflicts the merge would have now, and save nothing. */
  dryRun?: boolean;
  /** How to settle conflicts, by path. With every conflict covered, the merge lands. */
  resolve?: Resolution[];
}

/** What one conflicting path becomes: give one of `take`, `text`, `base64`, `parts` or `delete`. */
export type Resolution = Schemas["Resolution"];

export class Namespace {
  constructor(
    readonly client: Client,
    readonly name: string,
  ) {}

  branch(name: string): Branch {
    return new Branch(this, name);
  }

  /** One page of branches, in name order. */
  async branches(page: Page = {}): Promise<Schemas["Branch"][]> {
    const params = { path: { namespace: this.name }, query: page };
    return unwrap(await this.client.GET("/namespaces/{namespace}/branches", { params }));
  }

  /** Every branch, a page at a time. */
  allBranches(): AsyncGenerator<Schemas["Branch"], void, undefined> {
    return everything(
      (page) => this.branches(page),
      (branch) => branch.name,
    );
  }

  /** Creates an empty branch. */
  async createBranch(name: string): Promise<Branch> {
    const path = { namespace: this.name };
    unwrap(
      await this.client.POST("/namespaces/{namespace}/branches", {
        params: { path },
        body: { name },
      }),
    );
    return this.branch(name);
  }

  /**
   * Merges `from` into `into`. Resolves with the new head, or with the
   * paths that conflict (then nothing was saved), less those `resolve`
   * covers. A dry run resolves with a null head and the conflicts a merge
   * would have now.
   */
  async merge(
    from: string,
    into: string,
    options: MergeOptions = {},
  ): Promise<Schemas["MergeResult"]> {
    const { dryRun, ...rest } = options;
    const answer = await this.client.POST("/namespaces/{namespace}/merges", {
      params: { path: { namespace: this.name } },
      body: { from, into, ...rest, dry_run: dryRun },
    });
    if (answer.response.status === 409) {
      return answer.error as Schemas["MergeResult"];
    }
    return unwrap(answer);
  }

  /**
   * Uploads up to 16 MiB of a large file and returns the part's hash. A commit's
   * `parts` joins parts into one file within 7 days.
   */
  async upload(bytes: Uint8Array): Promise<string> {
    const answer = await this.client.POST("/namespaces/{namespace}/uploads", {
      params: { path: { namespace: this.name } },
      // The bytes go as they are, not as JSON.
      body: bytes as unknown as string,
      bodySerializer: (body) => body,
      headers: { "content-type": "application/octet-stream" },
    });
    return unwrap(answer).part;
  }

  /**
   * Short-lived S3 credentials that reach only this namespace's data. The
   * server answers 501 when it has no STS role to mint them with.
   */
  async credentials(access: "read" | "write" = "write"): Promise<Schemas["StoreCredentials"]> {
    const params = { path: { namespace: this.name } };
    return unwrap(
      await this.client.POST("/namespaces/{namespace}/credentials", { params, body: { access } }),
    );
  }

  /** One page of the live sessions. */
  async sessions(page: Page = {}): Promise<Schemas["Session"][]> {
    const params = { path: { namespace: this.name }, query: page };
    return unwrap(await this.client.GET("/namespaces/{namespace}/sessions", { params }));
  }

  /** Every live session, a page at a time. */
  allSessions(): AsyncGenerator<Schemas["Session"], void, undefined> {
    return everything(
      (page) => this.sessions(page),
      (session) => session.id,
    );
  }

  /** Starts a session. Call `keepAlive` or `heartbeat` so it does not end. */
  async startSession(label: string, seconds?: number): Promise<Session> {
    const path = { namespace: this.name };
    const session = unwrap(
      await this.client.POST("/namespaces/{namespace}/sessions", {
        params: { path },
        body: { label, seconds },
      }),
    );
    return new Session(this, session.id);
  }
}
