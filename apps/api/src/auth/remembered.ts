/**
 * Values looked up in Postgres, kept for a while so most requests skip the
 * lookup. Postgres tells every server when a row changes (`Changes`), which
 * drops it here; `ttl` bounds how long a missed notice can matter. A lookup
 * that started before a drop is not kept, so an old value can't come back.
 */
export class Remembered<V> {
  readonly #ttl: number;
  readonly #max: number;
  readonly #kept = new Map<string, { at: number; value: V }>();
  readonly #loading = new Map<string, Promise<V>>();
  #dropped = 0;

  constructor(ttl: number, max = 100_000) {
    this.#ttl = ttl;
    this.#max = max;
  }

  async get(key: string, load: () => Promise<V>, keep: (value: V) => boolean = () => true) {
    const kept = this.#kept.get(key);
    if (kept && performance.now() - kept.at < this.#ttl) return kept.value;
    const loading = this.#loading.get(key);
    if (loading) return loading;
    const dropped = this.#dropped;
    const started = performance.now();
    const next = load().then((value) => {
      if (dropped === this.#dropped && keep(value)) this.#set(key, { at: started, value });
      return value;
    });
    this.#loading.set(key, next);
    try {
      return await next;
    } finally {
      this.#loading.delete(key);
    }
  }

  drop(key: string) {
    this.#dropped++;
    this.#kept.delete(key);
  }

  dropWhere(test: (key: string) => boolean) {
    this.#dropped++;
    for (const key of this.#kept.keys()) if (test(key)) this.#kept.delete(key);
  }

  clear() {
    this.#dropped++;
    this.#kept.clear();
  }

  #set(key: string, entry: { at: number; value: V }) {
    this.#kept.delete(key);
    if (this.#kept.size >= this.#max) this.#kept.delete(this.#kept.keys().next().value!);
    this.#kept.set(key, entry);
  }
}
