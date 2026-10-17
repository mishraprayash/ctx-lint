import { normalizeRel } from '../../core/paths.js';
import type { Candidate, Classification, IgnoreReason } from '../../core/references.js';
import { classifyShell } from './command.js';
import type { ClassifyContext } from './context.js';
import { ignoreReason } from './ignore-patterns.js';
import { classifyPackageToken, isNodeBuiltin, packageNameFromSpecifier } from './package.js';
import { classifyPathToken } from './path.js';

export type { ClassifyContext } from './context.js';
export { classifyContextFor } from './context.js';

/**
 * Turns a candidate into what it references. Always returns at least one entry; candidates
 * that aren't references come back as `ignored` with a reason (useful for `--dump-refs`).
 */
export function classify(candidate: Candidate, ctx: ClassifyContext): Classification[] {
  if (ctx.ignorePatterns.some((pattern) => pattern.test(candidate.raw))) {
    return ignored(candidate, 'user-pattern');
  }
  switch (candidate.origin) {
    case 'inlineCode':
      return classifyInline(candidate, ctx);
    case 'codeBlock':
      return orIgnored(candidate, classifyShell(candidate, ctx));
    case 'link':
      return classifyLink(candidate, ctx);
    case 'import':
      return classifyImport(candidate);
    case 'frontmatter':
      return classifyGlob(candidate);
  }
}

function classifyInline(candidate: Candidate, ctx: ClassifyContext): Classification[] {
  const token = candidate.raw.trim();
  if (/\s/.test(token)) return orIgnored(candidate, classifyShell(candidate, ctx));

  const lead = candidate.raw.length - candidate.raw.trimStart().length;
  const range = candidate.locate(lead, lead + token.length);

  const path = classifyPathToken(token, ctx, { origin: 'inlineCode' });
  if (path !== null) {
    if ('ignored' in path) return ignored(candidate, path.ignored);
    return [{ kind: 'path', ...path.path, candidate, range }];
  }

  const pkg = classifyPackageToken(token, candidate);
  if (pkg !== null) {
    if ('ignored' in pkg) return ignored(candidate, pkg.ignored);
    return [{ kind: 'package', name: token, ecosystem: 'npm', ...pkg, candidate, range }];
  }

  return ignored(candidate, 'not-a-reference');
}

/** Markdown links resolve relative to the file they're in. */
function classifyLink(candidate: Candidate, ctx: ClassifyContext): Classification[] {
  const url = candidate.raw;
  const reason = ignoreReason(url);
  if (reason) return ignored(candidate, reason);
  const relative = /^(?:\.{1,2}\/|\/)/.test(url) ? url : `./${url}`;
  const path = classifyPathToken(relative, ctx, { origin: 'link' });
  if (path === null) return ignored(candidate, 'not-a-reference');
  if ('ignored' in path) return ignored(candidate, path.ignored);
  return [{ kind: 'path', ...path.path, candidate, range: candidate.range }];
}

/** Import specifiers in example code: only package names are checked (PLAN.md §14 Q4). */
function classifyImport(candidate: Candidate): Classification[] {
  const specifier = candidate.raw;
  if (/^[./]/.test(specifier)) return ignored(candidate, 'not-a-reference');
  if (/^[@#~$]\//.test(specifier) || specifier.startsWith('#')) return ignored(candidate, 'alias');
  if (isNodeBuiltin(specifier)) return ignored(candidate, 'not-a-reference');
  const reason = ignoreReason(specifier);
  if (reason) return ignored(candidate, reason);
  const name = packageNameFromSpecifier(specifier);
  if (name === null) return ignored(candidate, 'not-a-reference');
  return [
    {
      kind: 'package',
      name,
      ecosystem: 'npm',
      negated: false,
      confidence: 'high',
      candidate,
      range: candidate.locate(0, name.length),
    },
  ];
}

/** Frontmatter globs (`globs`, `applyTo`) are repo-root relative. */
function classifyGlob(candidate: Candidate): Classification[] {
  const value = normalizeRel(candidate.raw);
  if (value === '') return ignored(candidate, 'not-a-reference');
  return [
    {
      kind: 'path',
      value,
      isDir: false,
      isGlob: /[*?{]/.test(value),
      fromFile: false,
      bare: false,
      rooted: false,
      confidence: 'high',
      candidate,
      range: candidate.range,
    },
  ];
}

function ignored(candidate: Candidate, reason: IgnoreReason): Classification[] {
  return [{ kind: 'ignored', reason, candidate }];
}

function orIgnored(candidate: Candidate, results: Classification[]): Classification[] {
  return results.length > 0 ? results : ignored(candidate, 'not-a-reference');
}
