/** `value`, or `fallback` when it is missing, kept from `min` to `max`. */
export const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value ?? fallback));

export interface Page {
  limit?: number;
  after?: string;
}

export const pageSize = (limit?: number, fallback = 1000) => clamp(limit, fallback, 1, 1000);

/** One page of `items` in `key` order: those after `after`, even if that one is gone now. */
export function pageOf<T>(items: T[], key: (item: T) => string, { limit, after }: Page) {
  return items
    .filter((item) => after === undefined || key(item) > after)
    .sort((a, b) => (key(a) < key(b) ? -1 : 1))
    .slice(0, pageSize(limit));
}
