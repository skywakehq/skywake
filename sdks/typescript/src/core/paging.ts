/** One page of a list: at most `limit` items (1000 at most), after the key `after`. */
export interface Page {
  limit?: number;
  after?: string;
}

const PAGE = 1000;

/** Every item of a list, asking for one page at a time until a short one. */
export async function* everything<T>(
  get: (page: Page) => Promise<T[]>,
  key: (item: T) => string,
): AsyncGenerator<T, void, undefined> {
  for (let after: string | undefined; ;) {
    const items = await get({ limit: PAGE, after });
    yield* items;
    if (items.length < PAGE) return;
    after = key(items[items.length - 1]!);
  }
}
