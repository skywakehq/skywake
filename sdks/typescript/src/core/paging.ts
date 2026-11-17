export interface Page<T> {
  data: T[];
  next: string | null;
}

export async function* pages<T>(
  load: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  for (let cursor: string | undefined; ; ) {
    const page = await load(cursor);
    yield* page.data;
    if (!page.next) return;
    cursor = page.next;
  }
}

export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}
