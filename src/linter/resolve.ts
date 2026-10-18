import path from 'node:path';
import { distance } from 'fastest-levenshtein';
import { basenameRel, dirnameRel, joinRel, normalizeRel } from '../core/paths.js';
import type { PathReference } from '../core/references.js';
import type { EntryType, FileIndex } from '../fs/file-index.js';
import type { GitRenames } from '../fs/git-renames.js';
import { closest } from './suggest.js';

// Resolving path references against the index (PLAN.md §5.3 C, "Resolution order").

export type Resolution =
  | { status: 'found'; path: string; type: EntryType }
  /** Written with a trailing slash, but it's a file. */
  | { status: 'not-a-directory'; path: string }
  | { status: 'missing'; tried: string[] };

/**
 * Repo-relative locations a path reference may mean, in order: the repo root, then the file's
 * directory and each directory up from it. Nested instruction files often write paths relative
 * to their package (`src/util/` in `extensions/copilot/src/…/AGENTS.md`).
 */
export function candidatesFor(ref: PathReference, fileDir: string): string[] {
  if (ref.fromFile || ref.rooted) return [ref.value];
  const out = [ref.value];
  for (let dir = fileDir; dir !== ''; dir = dirnameRel(dir)) {
    const candidate = joinRel(dir, ref.value);
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** Extensions and index files tried for extensionless module paths (`@/components/Button`). */
const MODULE_SUFFIXES = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
]
  .flatMap((ext) => [ext, `/index${ext}`])
  .concat(['.md', '.mdx', '.json']);

const TS_SOURCES: readonly ((p: string) => string)[] = [
  (p) => p.replace(/\.js$/, '.ts'),
  (p) => p.replace(/\.js$/, '.tsx'),
  (p) => p.replace(/\.jsx$/, '.tsx'),
  (p) => p.replace(/\.mjs$/, '.mts'),
  (p) => p.replace(/\.cjs$/, '.cts'),
];

export function resolvePath(ref: PathReference, files: FileIndex, fileDir: string): Resolution {
  const resolution = resolveOne(ref, files, fileDir);
  if (resolution.status === 'found' || ref.unaliased === undefined) return resolution;
  const { unaliased, ...plain } = ref;
  const asWritten = resolveOne({ ...plain, value: unaliased }, files, fileDir);
  if (asWritten.status !== 'missing') return asWritten;
  return resolution.status === 'missing'
    ? { status: 'missing', tried: [...resolution.tried, ...asWritten.tried] }
    : resolution;
}

function resolveOne(ref: PathReference, files: FileIndex, fileDir: string): Resolution {
  const tried = candidatesFor(ref, fileDir);
  let notDir: string | undefined;
  for (const candidate of tried) {
    const type = files.get(candidate);
    // `src/auth/guard` written like an import: try what a module resolver would.
    if (type === null && !ref.isDir && !/\.[^/]+$/.test(candidate)) {
      const found = MODULE_SUFFIXES.map((suffix) => candidate + suffix).find((p) =>
        files.isFile(p),
      );
      if (found) return { status: 'found', path: found, type: 'file' };
    }
    // `./x.contribution.js` in TypeScript ESM code means `x.contribution.ts`.
    if (type === null && /\.(?:m|c)?jsx?$/.test(candidate)) {
      const source = TS_SOURCES.map((map) => map(candidate)).find(
        (p) => p !== candidate && files.isFile(p),
      );
      if (source) return { status: 'found', path: source, type: 'file' };
    }
    if (type === null) continue;
    if (ref.isDir && type === 'file') {
      notDir ??= candidate;
      continue;
    }
    return { status: 'found', path: candidate, type };
  }

  // A bare name (`package.json`) may live anywhere.
  if (ref.bare) {
    const anywhere = files.byBasename(ref.value)[0];
    if (anywhere) return { status: 'found', path: anywhere, type: files.get(anywhere) ?? 'file' };
  }

  // `components/Button.tsx` when the file is `src/components/Button.tsx`: only when the first
  // segment isn't a real top-level entry (otherwise the author clearly meant the root).
  if (!ref.fromFile && !ref.rooted && !ref.bare) {
    const first = ref.value.split('/')[0] as string;
    if (candidatesFor({ ...ref, value: first }, fileDir).every((p) => !files.exists(p))) {
      // `vs/code/browser/workbench/workbench.js` (build output) for `src/vs/…/workbench.ts`.
      const sources = ref.isDir ? [] : TS_SOURCES.map((map) => map(ref.value));
      // Never satisfied by test data, which would hide a real stale path.
      const inTestData = TEST_DATA.test(`${fileDir}/`);
      for (const suffix of new Set([ref.value, ...sources])) {
        const match = files
          .withSuffix(suffix, ref.isDir ? 'dir' : undefined)
          .find((p) => inTestData || !TEST_DATA.test(p));
        if (match) return { status: 'found', path: match, type: files.get(match) ?? 'file' };
      }
    }
  }

  // `hogli/cli.py` in `tools/hogli/AGENTS.md` for `tools/hogli/src/hogli/cli.py`: somewhere
  // below the file's own directory.
  if (!ref.fromFile && !ref.rooted && fileDir !== '') {
    const below = files
      .withSuffix(ref.value, ref.isDir ? 'dir' : undefined)
      .filter((p) => p.startsWith(`${fileDir}/`));
    if (below.length === 1) {
      const found = below[0] as string;
      return { status: 'found', path: found, type: files.get(found) ?? 'file' };
    }
  }

  if (notDir !== undefined) return { status: 'not-a-directory', path: notDir };
  return { status: 'missing', tried };
}

/** Exact-case paths that differ from what was written only in case. */
export function caseMatches(ref: PathReference, files: FileIndex, fileDir: string): string[] {
  const found = new Set<string>();
  const values = ref.unaliased === undefined ? [ref.value] : [ref.value, ref.unaliased];
  const candidates = values.flatMap((value) => candidatesFor({ ...ref, value }, fileDir));
  for (const candidate of candidates) {
    for (const variant of files.caseVariants(candidate)) {
      if (!ref.isDir || files.isDirectory(variant)) found.add(variant);
    }
  }
  return [...found].sort();
}

export interface PathSuggestion {
  paths: string[];
  /** Unique and safe enough for `--fix`. */
  fixable: boolean;
  /** Set when git history says the path was renamed: the commit that did it. */
  renamedIn?: string;
}

/**
 * Where a missing path probably went: the same file name elsewhere (it was moved), or a
 * near-miss name next to where it should be (it was renamed or misspelled).
 */
export function suggestPath(
  ref: PathReference,
  files: FileIndex,
  fileDir: string,
  renames?: GitRenames,
): PathSuggestion {
  // Git history knows best: a recorded rename beats any guess.
  if (renames) {
    for (const candidate of candidatesFor(ref, fileDir)) {
      const renamed = ref.isDir ? renames.directory(candidate) : renames.file(candidate);
      if (renamed) return { paths: [renamed.to], fixable: true, renamedIn: renamed.commit };
    }
  }

  // A suggestion must be a real path *and* a plausible one: never test data (unless the
  // instruction file lives there too), and never an unrelated file that shares a common name.
  const inTestData = TEST_DATA.test(`${fileDir}/`);
  const usable = (p: string) => !files.isIgnored(p) && (inTestData || !TEST_DATA.test(p));

  const base = basenameRel(ref.value);
  const wantDir = ref.isDir;
  const moved = files
    .byBasename(base)
    .filter((p) => (wantDir ? files.isDirectory(p) : true))
    .filter(usable);
  // Auto-fixable only with evidence beyond the name: a shared directory (`apps/web/src/x.ts` →
  // `packages/ui/src/x.ts`). `rules/backend/api.md` → `docs/api.md` is shown, not applied.
  if (moved.length === 1) {
    const only = moved[0] as string;
    return { paths: moved, fixable: sharedParents(ref.value, only) > 0 };
  }
  if (moved.length > 1) {
    // `src/client.ts` → `packages/cli/src/client.ts` (shares `src/`), not any other `client.ts`.
    const related = moved
      .map((p) => ({ p, shared: sharedParents(ref.value, p) }))
      .filter((c) => c.shared > 0)
      .sort((a, b) => b.shared - a.shared);
    const best = related.filter((c) => c.shared === related[0]?.shared).map((c) => c.p);
    // Several files have this name: even the best match is a choice, so it's never applied.
    return { paths: best.slice(0, 3), fixable: false };
  }

  for (const candidate of candidatesFor(ref, fileDir)) {
    const renamed = nearMiss(candidate, files).filter(usable);
    if (renamed.length > 0) return { paths: renamed, fixable: false };
  }
  return { paths: [], fixable: false };
}

/** Test data, examples and vendored code: not where a real instruction's file went. */
const TEST_DATA =
  /(?:^|\/)(?:fixtures|__fixtures__|testdata|test-data|examples?|vendor|third_party)\//;

/** How many directories just above the file name two paths have in common. */
function sharedParents(a: string, b: string): number {
  const left = a.split('/').slice(0, -1).reverse();
  const right = b.split('/').slice(0, -1).reverse();
  let n = 0;
  while (n < left.length && left[n] === right[n]) n++;
  return n;
}

/** A file name without its extension. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Lowercase extension of a file name (`.ts`), `''` for none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** Fixes the first missing segment by edit distance, then checks the rest still exists. */
function nearMiss(target: string, files: FileIndex): string[] {
  const segments = target.split('/');
  let existing = '';
  for (let i = 0; i < segments.length; i++) {
    const next = joinRel(existing, segments[i] as string);
    if (files.exists(next)) {
      existing = next;
      continue;
    }
    const rest = segments.slice(i + 1).join('/');
    // `latest/` is not a typo of `pytest.ini`: a near miss keeps the extension, or (for
    // `guards/` → `guard.ts`) is at most one letter from the name without it.
    // Short names need a closer match: `latest` is two edits from `test`, but no typo of it.
    const segment = segments[i] as string;
    const ext = extensionOf(segment);
    const stem = stemOf(segment).toLowerCase();
    const allowed = Math.max(1, Math.floor(stem.length / 4));
    return closest(segment, files.children(existing))
      .filter((sibling) => {
        const d = distance(stem, stemOf(sibling).toLowerCase());
        return extensionOf(sibling) === ext ? d <= allowed : d <= 1;
      })
      .map((sibling) => joinRel(existing, sibling, rest))
      .filter((p) => files.exists(p));
  }
  return [];
}

/**
 * A repo-relative path as the author of a nested file would write it: relative to that file's
 * directory when it's inside it (`./`-style references are handled by `rewriteAs`).
 */
export function displayPath(ref: PathReference, repoPath: string, fileDir: string): string {
  if (ref.rooted || fileDir === '' || !repoPath.startsWith(`${fileDir}/`)) return repoPath;
  return ref.fromFile
    ? `./${repoPath.slice(fileDir.length + 1)}`
    : repoPath.slice(fileDir.length + 1);
}

/**
 * How to write `suggestion` in place of the original token, keeping its style (`./`, leading
 * `/`, trailing `/`). `null` when the original has extras (`:42`, `#anchor`, aliases) that a
 * plain replacement would lose.
 */
export function rewriteAs(
  ref: PathReference,
  original: string,
  suggestion: string,
  fileDir: string,
  files: FileIndex,
): string | null {
  const plain = original.replace(/\/+$/, '');
  const expected = ref.fromFile ? path.posix.relative(fileDir, ref.value) : ref.value;
  const written = normalizeRel(plain.replace(/^\/+/, ''));
  if (written !== normalizeRel(expected)) return null;

  let text: string;
  if (ref.fromFile) {
    const rel = path.posix.relative(fileDir, suggestion);
    text = rel.startsWith('../') ? rel : `./${rel}`;
  } else {
    text = ref.rooted ? `/${suggestion}` : displayPath(ref, suggestion, fileDir);
    // A `./x` in a command or prose keeps its `./`.
    if (plain.startsWith('./') && !text.startsWith('/')) text = `./${text}`;
  }
  if (original.endsWith('/') && files.isDirectory(suggestion)) text += '/';
  return text;
}
