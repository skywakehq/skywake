export function onceEvery(ms: number) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < ms) return false;
    last = now;
    return true;
  };
}
