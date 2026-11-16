export interface Asked {
  limit?: number;
  cursor?: string;
}

export const DEFAULT_LIMIT = 100;

export function pageOf<T>(items: T[], key: (item: T) => string, { limit, cursor }: Asked) {
  const size = limit ?? DEFAULT_LIMIT;
  const sorted = [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const after = cursor === undefined ? sorted : sorted.filter((item) => key(item) > cursor);
  const data = after.slice(0, size);
  const next = after.length > size ? key(data[data.length - 1]!) : null;
  return { data, next };
}

export function pageAfter<T>(data: T[], size: number, key: (item: T) => string) {
  return {
    data,
    next: data.length === size && data.length > 0 ? key(data[data.length - 1]!) : null,
  };
}

export const whole = <T>(data: T[]) => ({ data, next: null });
