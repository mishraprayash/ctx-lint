import { joinRel, normalizeRel } from '../../core/paths.js';
import type { CandidateOrigin, IgnoreReason, PathReference } from '../../core/references.js';
import type { Confidence } from '../../core/types.js';
import type { ClassifyContext } from './context.js';
import { ignoreReason, unresolvedLooksLike } from './ignore-patterns.js';
import {
  BRAND_NAMES,
  KNOWN_DOTFILES,
  KNOWN_EXTENSIONS,
  METHOD_RECEIVERS,
  SYSTEM_DIRS,
  WELL_KNOWN_FILES,
} from './words.js';

/** The path-specific fields of a `PathReference`. */
export type PathShape = Pick<
  PathReference,
  'value' | 'isDir' | 'isGlob' | 'fromFile' | 'bare' | 'rooted' | 'anchor' | 'confidence'
>;

export type PathResult = { path: PathShape } | { ignored: IgnoreReason } | null;

export interface PathOptions {
  origin: CandidateOrigin;
  /** Treat as a directory even without a trailing slash (`cd dir`). */
  forceDir?: boolean;
}

/** Path-safe characters. Anything else (spaces, quotes, `=`, `;`, `|`) means "not a path". */
const PATH_CHARS = /^[\p{L}\p{N}_@.\-+~/[\]()*?{},!&%#]+$/u;
/** Link destinations may contain (decoded) spaces: `[x](<my notes.md>)`, `[x](my%20notes.md)`. */
const LINK_PATH_CHARS = /^[\p{L}\p{N}_@.\-+~/[\]()*?{},!&%# ]+$/u;

/**
 * Decides whether a single token is a path, and how sure we are (PLAN.md §5.3 C).
 * Returns `null` when the token isn't path-shaped at all, so other classifiers can try.
 */
export function classifyPathToken(
  token: string,
  ctx: ClassifyContext,
  options: PathOptions,
): PathResult {
  let t = token;
  if (options.origin === 'link') t = safeDecode(t);

  // Aliases first, so `@/components` can become `src/components`.
  let aliased = false;
  for (const [prefix, replacement] of Object.entries(ctx.aliases)) {
    if (t.startsWith(prefix)) {
      t = replacement + t.slice(prefix.length);
      aliased = true;
      break;
    }
  }

  const reason = ignoreReason(t);
  if (reason) return { ignored: reason };
  if (!aliased && /^[@#~]\//.test(t)) return { ignored: 'alias' };
  // `@scope/name` is a package (or a package subpath), not a file.
  if (/^@[a-z0-9]/i.test(t)) return null;

  // `src/a.ts#setup`, `src/a.ts#L10` (links keep the anchor; it's checked separately).
  let anchor: string | undefined;
  const hash = t.indexOf('#');
  if (hash > 0) {
    anchor = t.slice(hash + 1);
    t = t.slice(0, hash);
  } else if (hash === 0) {
    return { ignored: 'not-a-reference' };
  }

  t = t.replace(/:\d+(?::\d+)?$/, ''); // `src/a.ts:42:7`
  if (/^[\w.-]+(?:\\[\w.-]+)+\\?$/.test(t)) t = t.replaceAll('\\', '/'); // `src\utils\a.ts`

  // `/users/:id`, `api/:version/items`: route patterns, not files.
  if (/(?:^|\/):[A-Za-z_]\w*(?=\/|$)/.test(t)) return { ignored: 'route' };
  if (!(options.origin === 'link' ? LINK_PATH_CHARS : PATH_CHARS).test(t)) return null;
  // Parentheses are only allowed as whole segments: Next.js route groups like `app/(auth)/`.
  if (/[()]/.test(t.replace(/(^|\/)\([^/()]+\)(?=\/|$)/g, '$1'))) return null;
  if (t.startsWith('//')) return null;

  const rooted = t.startsWith('/');
  const fromFile = /^\.\.?(?:\/|$)/.test(t);
  const isDir = t.endsWith('/') || options.forceDir === true;
  const isGlob = /[*?{]/.test(t);
  const body = rooted ? t.replace(/^\/+/, '') : t;

  const value = fromFile ? joinRel(ctx.fileDir, body) : normalizeRel(body);
  if (value === '..' || value.startsWith('../')) return { ignored: 'outside-repo' };
  if (value === '') return { ignored: 'not-a-reference' };

  const segments = value.split('/');
  const first = segments[0] as string;
  const base = segments[segments.length - 1] as string;
  const hasSlash = segments.length > 1 || rooted || fromFile;
  const ext = extensionOf(base);
  const knownExt = ext !== null && KNOWN_EXTENSIONS.has(ext);
  const wellKnown =
    WELL_KNOWN_FILES.has(base) || /^(?:Dockerfile|Containerfile|Makefile)\.[\w.-]+$/.test(base);
  const dotfile =
    base.startsWith('.') &&
    (KNOWN_DOTFILES.has(base) ||
      /^\.(?:env|eslintrc|prettierrc|stylelintrc|babelrc)(?:\.|$)/.test(base));
  const fileLike = knownExt || wellKnown || dotfile;

  const shape = (confidence: Confidence, bare: boolean): PathResult => ({
    path: {
      value,
      isDir,
      isGlob,
      fromFile,
      bare,
      rooted,
      confidence,
      ...(anchor !== undefined && anchor !== '' ? { anchor } : {}),
    },
  });

  if (!hasSlash) {
    if (BRAND_NAMES.has(base.toLowerCase())) return { ignored: 'not-a-reference' };
    if (/^\.[a-z0-9]+$/i.test(base) && !dotfile) return { ignored: 'not-a-reference' }; // `.ts`
    if (ext === 'json' && METHOD_RECEIVERS.has(stemOf(base))) return { ignored: 'not-a-reference' };
    if (isGlob) {
      return /^[*?{},.]+$/.test(base) ? { ignored: 'placeholder' } : shape('medium', true);
    }
    if (isDir) return shape('medium', false); // `scripts/`
    return fileLike ? shape('medium', true) : null;
  }

  if (fromFile) return shape('high', false);

  const firstExists = ctx.files.exists(first) || ctx.files.exists(joinRel(ctx.fileDir, first));
  if (!firstExists) {
    if (rooted) return { ignored: SYSTEM_DIRS.has(first) ? 'system-path' : 'route' };
    const looksLike = unresolvedLooksLike(value);
    if (looksLike) return { ignored: looksLike };
  }
  if (fileLike || isGlob || isDir) return shape(firstExists ? 'high' : 'medium', false);
  return shape(firstExists ? 'medium' : 'low', false);
}

/** Lowercase extension of a file name, or `null`. Dotfiles like `.env` have none. */
export function extensionOf(base: string): string | null {
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function stemOf(base: string): string {
  const dot = base.indexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

function safeDecode(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
