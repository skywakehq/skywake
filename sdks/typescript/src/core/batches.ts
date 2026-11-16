export interface Limits {
  count: number;
  bytes: number;
}

export function* batches<T>(
  items: readonly T[],
  limits: Limits,
  weigh: (item: T) => number,
): Generator<T[]> {
  let batch: T[] = [];
  let size = 0;
  for (const item of items) {
    const weight = weigh(item);
    if (batch.length === limits.count || (batch.length > 0 && size + weight > limits.bytes)) {
      yield batch;
      batch = [];
      size = 0;
    }
    batch.push(item);
    size += weight;
  }
  if (batch.length > 0) yield batch;
}
