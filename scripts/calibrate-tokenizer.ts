// Fits the heuristic tokenizer's weights against o200k (PLAN.md §7.1). Run with `pnpm calibrate`.
//
// Corpus: this repo's markdown (docs, fixtures, examples) plus README.md files of installed
// dependencies (prose, lists and code, like real agent rule files). Nothing is downloaded and
// the corpus isn't committed. Prints the fitted weights (paste into src/auditor/heuristic.ts)
// and the error on a held-out 30% of the corpus.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import {
  estimateTokens,
  extractFeatures,
  FEATURE_NAMES,
  type Weights,
} from '../src/auditor/heuristic.js';

const root = path.resolve(import.meta.dirname, '..');

function collect(): { name: string; text: string }[] {
  const files = new Set<string>();
  const walk = (dir: string, depth: number, pick: (file: string) => boolean) => {
    if (depth < 0) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'dist') continue;
        walk(full, depth - 1, pick);
      } else if (pick(full)) {
        files.add(fs(full));
      }
    }
  };
  const fs = (p: string) => path.relative(root, p);
  const sized = (p: string) => {
    const size = statSync(p).size;
    return size > 400 && size < 60_000;
  };
  // The repo's own markdown, minus node_modules.
  for (const dir of ['docs', 'test/fixtures', 'examples', '.']) {
    walk(path.join(root, dir), dir === '.' ? 0 : 6, (p) => /\.(md|mdc)$/.test(p) && sized(p));
  }
  // Dependency READMEs (deduplicated by package name).
  const seen = new Set<string>();
  walk(path.join(root, 'node_modules/.pnpm'), 6, (p) => {
    if (!/\/README\.md$/i.test(p) || !sized(p)) return false;
    const pkg = path.basename(path.dirname(p));
    if (seen.has(pkg)) return false;
    seen.add(pkg);
    return true;
  });
  return [...files]
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(root, name), 'utf8') }));
}

/** Weighted least squares minimizing relative error, with non-negative weights (active set). */
function fitWeights(rows: { x: number[]; y: number }[]): number[] {
  const k = FEATURE_NAMES.length;
  const active = new Set(FEATURE_NAMES.map((_, i) => i));
  for (;;) {
    const idx = [...active];
    const a = idx.map(() => idx.map(() => 0));
    const b = idx.map(() => 0);
    for (const { x, y } of rows) {
      const w = 1 / (y * y); // Relative error: every file counts equally.
      idx.forEach((i, r) => {
        b[r] = (b[r] as number) + w * (x[i] as number) * y;
        idx.forEach((j, c) => {
          (a[r] as number[])[c] =
            ((a[r] as number[])[c] as number) + w * (x[i] as number) * (x[j] as number);
        });
      });
    }
    const solved = solve(a, b);
    const coef = new Array<number>(k).fill(0);
    idx.forEach((i, r) => {
      coef[i] = solved[r] as number;
    });
    const negative = idx.filter((i) => (coef[i] as number) < 0);
    if (negative.length === 0) return coef;
    for (const i of negative) active.delete(i);
  }
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (
        Math.abs((m[r] as number[])[col] as number) >
        Math.abs((m[pivot] as number[])[col] as number)
      )
        pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]];
    const p = (m[col] as number[])[col] as number;
    if (Math.abs(p) < 1e-12) continue; // Feature never occurs: leave its weight at 0.
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = ((m[r] as number[])[col] as number) / p;
      for (let c = col; c <= n; c++) {
        (m[r] as number[])[c] =
          ((m[r] as number[])[c] as number) - factor * ((m[col] as number[])[c] as number);
      }
    }
  }
  return m.map((row, i) => {
    const p = row[i] as number;
    return Math.abs(p) < 1e-12 ? 0 : (row[n] as number) / p;
  });
}

function stats(errors: number[]): string {
  const sorted = [...errors].map(Math.abs).sort((x, y) => x - y);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
  const bias = errors.reduce((s, e) => s + e, 0) / errors.length;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return `median ${pct(q(0.5))}, p90 ${pct(q(0.9))}, max ${pct(q(1))}, bias ${pct(bias)} (n=${errors.length})`;
}

const corpus = collect();
const rows = corpus.map(({ name, text }) => {
  const f = extractFeatures(text);
  return {
    name,
    text,
    x: FEATURE_NAMES.map((n) => f[n]),
    y: countTokens(text, { disallowedSpecial: new Set() }),
  };
});
// Deterministic split: every third file is held out.
const train = rows.filter((_, i) => i % 3 !== 0);
const heldOut = rows.filter((_, i) => i % 3 === 0);

const coef = fitWeights(train);
const weights = Object.fromEntries(
  FEATURE_NAMES.map((n, i) => [n, Number((coef[i] as number).toFixed(3))]),
) as Weights;
const errorsOf = (set: typeof rows) =>
  set.map((r) => (estimateTokens(r.text, weights) - r.y) / r.y);

console.log(
  `Corpus: ${rows.length} files, ${rows.reduce((s, r) => s + r.y, 0).toLocaleString()} o200k tokens\n`,
);
console.log('export const WEIGHTS: Weights = {');
for (const n of FEATURE_NAMES) console.log(`  ${n}: ${weights[n]},`);
console.log('};\n');
console.log(`Held-out error: ${stats(errorsOf(heldOut))}`);
console.log(`All files:      ${stats(errorsOf(rows))}`);
const committed = rows.map((r) => (estimateTokens(r.text) - r.y) / r.y);
console.log(`\nCommitted WEIGHTS (src/auditor/heuristic.ts) on all files: ${stats(committed)}`);
const typical = rows.filter((r) => !/[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]{8,}/u.test(r.text));
console.log(
  `  …excluding symbol-heavy files (${rows.length - typical.length}): ${stats(typical.map((r) => (estimateTokens(r.text) - r.y) / r.y))}`,
);
const worst = rows
  .map((r) => ({ name: r.name, e: (estimateTokens(r.text, weights) - r.y) / r.y }))
  .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
  .slice(0, 5);
console.log('\nLargest errors:');
for (const { name, e } of worst) console.log(`  ${(e * 100).toFixed(1).padStart(6)}%  ${name}`);
