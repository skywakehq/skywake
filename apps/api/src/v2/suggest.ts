export function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

export function closest(name: string, names: string[]): string | null {
  let best: string | null = null;
  let score = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const each of names) {
    const d = distance(name.toLowerCase(), each.toLowerCase());
    if (d < score) [best, score] = [each, d];
  }
  return best;
}
