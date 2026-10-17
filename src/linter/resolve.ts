import path from 'node:path';
import { basenameRel, joinRel, normalizeRel } from '../core/paths.js';
import type { PathReference } from '../core/references.js';
import type { EntryType, FileIndex } from '../fs/file-index.js';
import { closest } from './suggest.js';

// Resolving path references against the index (PLAN.md §5.3 C, "Resolution order").

export type Resolution =
  | { status: 'found'; path: string; type: EntryType }
  /** Written with a trailing slash, but it's a file. */
  | { status: 'not-a-directory'; path: string }
  | { status: 'missing'; tried: string[] };

/** Repo-relative locations a path reference may mean, in order. */
export function candidatesFor(ref: PathReference, fileDir: string): string[] {
  if (ref.fromFile || ref.rooted) return [ref.value];
  const fromDir = joinRel(fileDir, ref.value);
  return fromDir === ref.value ? [ref.value] : [ref.value, fromDir];
}

export function resolvePath(ref: PathReference, files: FileIndex, fileDir: string): Resolution {
  const tried = candidatesFor(ref, fileDir);
  let notDir: string | undefined;
  for (const candidate of tried) {
    const type = files.get(candidate);
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
    if (!files.exists(first) && !files.exists(joinRel(fileDir, first))) {
      const match = files.withSuffix(ref.value, ref.isDir ? 'dir' : undefined)[0];
      if (match) return { status: 'found', path: match, type: files.get(match) ?? 'file' };
    }
  }

  if (notDir !== undefined) return { status: 'not-a-directory', path: notDir };
  return { status: 'missing', tried };
}

/** Exact-case paths that differ from what was written only in case. */
export function caseMatches(ref: PathReference, files: FileIndex, fileDir: string): string[] {
  const found = new Set<string>();
  for (const candidate of candidatesFor(ref, fileDir)) {
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
}

/**
 * Where a missing path probably went: the same file name elsewhere (it was moved), or a
 * near-miss name next to where it should be (it was renamed or misspelled).
 */
export function suggestPath(ref: PathReference, files: FileIndex, fileDir: string): PathSuggestion {
  const base = basenameRel(ref.value);
  const wantDir = ref.isDir;
  const moved = files
    .byBasename(base)
    .filter((p) => (wantDir ? files.isDirectory(p) : true))
    .filter((p) => !files.isIgnored(p));
  if (moved.length > 0) return { paths: moved.slice(0, 3), fixable: moved.length === 1 };

  for (const candidate of candidatesFor(ref, fileDir)) {
    const renamed = nearMiss(candidate, files);
    if (renamed.length > 0) return { paths: renamed, fixable: false };
  }
  return { paths: [], fixable: false };
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
    return closest(segments[i] as string, files.children(existing))
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
  }
  if (original.endsWith('/') && files.isDirectory(suggestion)) text += '/';
  return text;
}
