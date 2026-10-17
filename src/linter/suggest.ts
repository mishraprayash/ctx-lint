import { distance } from 'fastest-levenshtein';

/**
 * Names from `options` that are close to `name`, best first. "Close" means a small edit
 * distance relative to length, compared against the whole name and its stem (`guard.ts` → `guard`).
 */
export function closest(name: string, options: Iterable<string>, limit = 3): string[] {
  const scored: [string, number][] = [];
  const lower = name.toLowerCase();
  for (const option of options) {
    if (option === name) continue;
    const o = option.toLowerCase();
    const stem = o.includes('.', 1) ? o.slice(0, o.indexOf('.', 1)) : o;
    const d = Math.min(distance(lower, o), distance(lower, stem));
    const threshold = Math.max(1, Math.min(3, Math.floor(Math.max(name.length, 4) / 3)));
    if (d <= threshold) scored.push([option, d]);
  }
  return scored
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([option]) => option);
}

/** `a`, `a or b`, `a, b or c`, with each item quoted. */
export function orList(items: readonly string[]): string {
  const quoted = items.map((i) => `"${i}"`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

/** Up to `max` names, then "and N more". */
export function preview(items: readonly string[], max = 6): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}
