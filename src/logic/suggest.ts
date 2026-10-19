/** Levenshtein distance, case-insensitive. */
export function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The closest candidate within a third of the name's length (at least 1 edit), if any. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d < bestD && d <= limit) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
