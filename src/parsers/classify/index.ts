import { normalizeRel } from '../../core/paths.js';
import type { Candidate, Classification, IgnoreReason } from '../../core/references.js';
import { classifyShell } from './command.js';
import type { ClassifyContext } from './context.js';
import { ignoreReason } from './ignore-patterns.js';
import { classifyPackageToken, isNodeBuiltin, packageNameFromSpecifier } from './package.js';
import { classifyPathToken } from './path.js';

export type { ClassifyContext } from './context.js';
export { classifyContextFor, referenceDir } from './context.js';

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
  // `Areas/<Product area>`: a template, not a command with a `<` redirect.
  if (/\S<[A-Za-z][^<>]*>/.test(token)) return ignored(candidate, 'placeholder');
  if (/\s/.test(token)) return orIgnored(candidate, classifyShell(candidate, ctx));

  const lead = candidate.raw.length - candidate.raw.trimStart().length;
  const range = candidate.locate(lead, lead + token.length);

  const path = classifyPathToken(token, ctx, { origin: 'inlineCode' });
  if (path !== null) {
    if ('ignored' in path) return ignored(candidate, path.ignored);
    const before = sentenceBefore(candidate);
    // "There is no `versions/` directory".
    if (/\b(?:no|not)\s*$/.test(before)) return ignored(candidate, 'not-a-reference');
    // "Import `./x.contribution.js` in `chat.contribution.ts`": relative to some source file.
    if (/^\.\.?\//.test(token) && /\b(?:import|imports|require)\s*$/.test(before)) {
      return ignored(candidate, 'not-a-reference');
    }
    // "the `supabase/troubleshooting` repo": a repository name.
    if (/^\s*(?:repo|repository|org|organization)\b/i.test(sentenceAfter(candidate))) {
      return ignored(candidate, 'not-a-reference');
    }
    // "files such as `LICENSES/Apache-2.0.txt`": an illustration, not a claim that it exists here.
    // "Never hand-edit generated files: `x`": generated output may legitimately be absent.
    // "Spec-driven work may use `.agents/specs/`": a possibility, not a claim it exists.
    const example =
      (EXAMPLE_CUE.test(before) && (path.path.confidence !== 'high' || path.path.isGlob)) ||
      HYPOTHETICAL_CUE.test(before) ||
      /\bgenerated\b/.test(lineBefore(candidate));
    return [
      { kind: 'path', ...path.path, ...(example ? { confidence: 'low' } : {}), candidate, range },
    ];
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

/** A modal verb right before the path: "may use `x`", "could also add `x`", "might live in `x`". */
const HYPOTHETICAL_CUE =
  /\b(?:may|might|could|can)\s+(?:also\s+|optionally\s+)?[a-z]+\s+(?:in\s+|to\s+|a\s+|an\s+|the\s+)?$/;

const EXAMPLE_CUE = /\b(?:such as|for example|for instance|like)\b|\be\.?g\./;

/** The lowercased text of the token's sentence before it ('' without context). */
function sentenceBefore(candidate: Candidate): string {
  const context = candidate.context;
  if (!context) return '';
  const before = context.text.slice(0, context.index);
  let start = 0;
  for (const match of before.matchAll(/[.!?;:]\s/g)) {
    // "e.g. `x`" and "i.e. `x`" don't end a sentence.
    if (!/\b(?:e\.g|i\.e|etc|vs)$/i.test(before.slice(0, match.index))) {
      start = match.index + match[0].length;
    }
  }
  return before.slice(start).toLowerCase();
}

/** The token's sentence after it ('' without context). */
function sentenceAfter(candidate: Candidate): string {
  const context = candidate.context;
  if (!context) return '';
  const after = context.text.slice(context.index + candidate.raw.length);
  const end = after.search(/[.!?;:](?:\s|$)/);
  return end === -1 ? after : after.slice(0, end);
}

/** The lowercased text of the token's line (list item, paragraph line) before it. */
function lineBefore(candidate: Candidate): string {
  const context = candidate.context;
  if (!context) return '';
  const before = context.text.slice(0, context.index);
  return before.slice(before.lastIndexOf('\n') + 1).toLowerCase();
}

function ignored(candidate: Candidate, reason: IgnoreReason): Classification[] {
  return [{ kind: 'ignored', reason, candidate }];
}

function orIgnored(candidate: Candidate, results: Classification[]): Classification[] {
  return results.length > 0 ? results : ignored(candidate, 'not-a-reference');
}
