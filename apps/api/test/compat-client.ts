type Request = (path: string, init: RequestInit) => Response | Promise<Response>;
type Body = Record<string, any>;
type Answer = { rows?: ({ id: any } & Record<string, any>)[]; [key: string]: any };

export class CompatError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`${status} ${message}`);
    this.status = status;
  }
}

// A plain HTTP client for the /compat API, with the calls the tests use.
export class CompatClient {
  readonly #request: Request;
  readonly #key: string;

  constructor(request: Request, key: string) {
    this.#request = request;
    this.#key = key;
  }

  async call(method: string, path: string, body?: unknown): Promise<Answer> {
    const response = await this.#request(`/compat${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer: Answer = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new CompatError(response.status, answer.error ?? JSON.stringify(answer));
    return answer;
  }

  namespace(name: string) {
    return new Namespace(this, name);
  }

  async *namespaces(params: { prefix?: string } = {}) {
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) });
      const page = await this.call("GET", `/v1/namespaces?${query}`);
      yield* page.namespaces as { id: string }[];
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

class Namespace {
  readonly #client: CompatClient;
  readonly #name: string;

  constructor(client: CompatClient, name: string) {
    this.#client = client;
    this.#name = encodeURIComponent(name);
  }

  #v1 = (rest = "") => `/v1/namespaces/${this.#name}${rest}`;
  #v2 = (rest = "") => `/v2/namespaces/${this.#name}${rest}`;

  write = (body: Body) => this.#client.call("POST", this.#v2(), body);
  branchFrom = (body: Body) =>
    this.#client.call("POST", this.#v2(), { branch_from_namespace: body });
  copyFrom = (body: Body) => this.#client.call("POST", this.#v2(), { copy_from_namespace: body });
  startCopyFrom = (body: Body) =>
    this.#client.call("POST", this.#v2("/async"), { copy_from_namespace: body });
  pollCopyFrom = (token: string) => this.#client.call("GET", this.#v1(`/operations/${token}`));
  deleteAll = () => this.#client.call("DELETE", this.#v2());
  query = (body: Body) => this.#client.call("POST", this.#v2("/query"), body);
  multiQuery = (body: Body) => this.#client.call("POST", this.#v2("/query"), body);
  explainQuery = (body: Body) => this.#client.call("POST", this.#v2("/explain_query"), body);
  metadata = () => this.#client.call("GET", this.#v2("/metadata"));
  updateMetadata = (body: Body) => this.#client.call("PATCH", this.#v1("/metadata"), body);
  schema = () => this.#client.call("GET", this.#v1("/schema"));
  updateSchema = (body: { schema: Body }) =>
    this.#client.call("POST", this.#v1("/schema"), body.schema);
  hintCacheWarm = () => this.#client.call("GET", this.#v1("/hint_cache_warm"));
  recall = (body: Body) => this.#client.call("POST", this.#v1("/_debug/recall"), body);

  async exists() {
    try {
      await this.schema();
      return true;
    } catch (error) {
      if (error instanceof CompatError && error.status === 404) return false;
      throw error;
    }
  }
}
