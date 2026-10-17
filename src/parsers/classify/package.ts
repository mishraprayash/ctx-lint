import { builtinModules } from 'node:module';
import type { Candidate, IgnoreReason } from '../../core/references.js';
import type { Confidence } from '../../core/types.js';
import {
  ARTICLES,
  CUE_PHRASES,
  IMPERATIVE_LEADS,
  NEGATION_AFTER,
  NEGATION_BEFORE,
  NON_PACKAGE_NOUNS,
  PACKAGE_NOUNS,
  PACKAGE_STOPLIST,
  STRONG_PACKAGE_CUES,
  WEAK_PACKAGE_CUES,
} from './words.js';

// Package mentions (PLAN.md §5.3 D). A bare word in backticks is only a package when the
// sentence around it says so; precision matters more than recall here.

/** npm package name grammar (lowercase; no leading dot, dash or underscore). */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

const BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.flatMap((m) => [m, m.split('/')[0] as string]),
);

export function isNodeBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    BUILTINS.has(specifier) ||
    BUILTINS.has(specifier.split('/')[0] as string)
  );
}

/** `@scope/pkg/sub/path` → `@scope/pkg`, `pkg/sub` → `pkg`. `null` when it's not a package. */
export function packageNameFromSpecifier(specifier: string): string | null {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
  return NPM_NAME.test(name) ? name : null;
}

export type PackageResult =
  | { confidence: Confidence; negated: boolean }
  | { ignored: IgnoreReason }
  | null;

/** Classifies a bare inline-code token, using the surrounding sentence for cues. */
export function classifyPackageToken(token: string, candidate: Candidate): PackageResult {
  if (!NPM_NAME.test(token) || token.length < 2) return null;
  if (PACKAGE_STOPLIST.has(token) || isNodeBuiltin(token)) return { ignored: 'not-a-reference' };

  const context = candidate.context;
  if (!context) return { confidence: 'low', negated: false };
  const { before, after } = sentenceAround(context.text, context.index, token.length);
  const beforeWords = words(before);
  const afterWords = words(after);

  // "`camel` case", "the `strict` mode": a concept, not a library. "Use `render` on triggers": a prop.
  if (
    afterWords[0] !== undefined &&
    (NON_PACKAGE_NOUNS.has(afterWords[0]) || afterWords[0] === 'on')
  ) {
    return { ignored: 'not-a-reference' };
  }

  // Cues must be right next to the token: "use `zod`", "the `zod` library", "built with `vite`".
  // (A cue anywhere in the sentence produced mostly false positives on real repos.)
  const nounAfter = afterWords[0] !== undefined && PACKAGE_NOUNS.has(afterWords[0]);
  const lead = beforeWords.slice(-3).filter((w, i, all) => i < all.length - 1 || !ARTICLES.has(w));
  const last = lead[lead.length - 1];
  const lastTwo = lead.slice(-2).join(' ');
  const strongVerb =
    (last !== undefined && STRONG_PACKAGE_CUES.has(last)) || CUE_PHRASES.includes(lastTwo);
  // The weak verb must start the instruction: "Use `zod`", "We prefer `pino`".
  const verbAt = beforeWords.lastIndexOf(last ?? '');
  const weakVerb =
    last !== undefined &&
    WEAK_PACKAGE_CUES.has(last) &&
    (last === 'using' || beforeWords.slice(0, verbAt).every((w) => IMPERATIVE_LEADS.has(w)));
  const plain = !/[-_.]/.test(token.replace(/^@[^/]+\//, ''));

  let confidence: Confidence = 'low';
  // Dotted and underscored tokens (`plugins.update`, `get_user`) are identifiers unless a noun
  // like "package" says otherwise.
  if (nounAfter) confidence = 'medium';
  else if (strongVerb && !/[._]/.test(token)) confidence = 'medium';
  else if (weakVerb && (plain || token.startsWith('@'))) confidence = 'medium';

  return { confidence, negated: isNegated(beforeWords, afterWords) };
}

function isNegated(beforeWords: readonly string[], afterWords: readonly string[]): boolean {
  const tail = beforeWords.slice(-4).join(' ');
  const head = afterWords.slice(0, 4).join(' ');
  return (
    NEGATION_BEFORE.some((phrase) => tail === phrase || tail.endsWith(` ${phrase}`)) ||
    NEGATION_AFTER.some((phrase) => head === phrase || head.startsWith(`${phrase} `))
  );
}

/** The text of the token's sentence before and after it, lowercased. */
function sentenceAround(
  text: string,
  index: number,
  length: number,
): { before: string; after: string } {
  const before = text.slice(0, index);
  const after = text.slice(index + length);
  const boundary = /[.!?;:](?:\s|$)/g;
  let start = 0;
  for (const match of before.matchAll(boundary)) start = match.index + match[0].length;
  const end = after.search(/[.!?;:](?:\s|$)/);
  return {
    before: before.slice(start).toLowerCase(),
    after: (end === -1 ? after : after.slice(0, end)).toLowerCase(),
  };
}

function words(text: string): string[] {
  return text
    .replaceAll('’', "'")
    .split(/[^a-z0-9'@/_-]+/)
    .filter((w) => w !== '');
}
