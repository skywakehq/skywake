/** The same numbers in the same order for the same text. */
function seeded(text: string) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft mesh of colour drawn from a name: the same name always gets the same orb. */
export function meshOf(name: string) {
  const random = seeded(name);
  const hue = random() * 360;
  const spread = 70 + random() * 120;
  // One blob near each corner, so the colours stay apart instead of mixing to one.
  const corners = [
    [20, 20],
    [80, 25],
    [25, 80],
    [78, 78],
  ];
  const blobs = corners.map(([x, y], i) => {
    const shade = `oklch(${0.72 + random() * 0.14} ${0.14 + random() * 0.08} ${(hue + (i * spread) / 3) % 360})`;
    const at = `${x + (random() - 0.5) * 30}% ${y + (random() - 0.5) * 30}%`;
    return `radial-gradient(circle at ${at}, ${shade}, transparent ${48 + random() * 20}%)`;
  });
  return [
    "radial-gradient(circle at 30% 24%, oklch(1 0 0 / 0.45), transparent 38%)",
    ...blobs,
    `oklch(0.7 0.14 ${(hue + spread / 2) % 360})`,
  ].join(", ");
}
