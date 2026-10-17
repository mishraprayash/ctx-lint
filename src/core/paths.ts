import path from 'node:path';

// Internally every path is POSIX and repo-relative, with no leading "./" and no trailing "/".
// The repo root itself is the empty string. Convert at the edges only (PLAN.md §8.4).

export function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

/** Normalizes a repo-relative path: POSIX separators, no "./", no trailing slash, "." → "". */
export function normalizeRel(p: string): string {
  const normalized = path.posix.normalize(toPosix(p));
  if (normalized === '.' || normalized === './') return '';
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Repo-relative POSIX path of `absPath`. Returns `null` when it lies outside `root`. */
export function relativeTo(root: string, absPath: string): string | null {
  const rel = toPosix(path.relative(root, absPath));
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return normalizeRel(rel);
}

export function toAbsolute(root: string, rel: string): string {
  return rel === '' ? root : path.join(root, ...rel.split('/'));
}

export function dirnameRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '' : rel.slice(0, i);
}

export function basenameRel(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

export function joinRel(...parts: string[]): string {
  return normalizeRel(parts.filter((p) => p !== '').join('/'));
}
