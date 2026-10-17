import { dirnameRel, joinRel, normalizeRel } from '../../core/paths.js';
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
  | 'value'
  | 'isDir'
  | 'isGlob'
  | 'fromFile'
  | 'bare'
  | 'rooted'
  | 'anchor'
  | 'confidence'
  | 'unaliased'
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
  let unaliased: string | undefined;
  for (const [prefix, replacement] of Object.entries(ctx.aliases)) {
    if (t.startsWith(prefix)) {
      // A plain-word alias (`lib/*`) may also be a real directory: keep the written path too.
      if (/^[\p{L}\p{N}]/u.test(prefix)) {
        const plain = classifyPathToken(token, { ...ctx, aliases: {} }, options);
        if (plain !== null && 'path' in plain) unaliased = plain.path.value;
      }
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
  if (options.origin !== 'link') t = t.replace(/[,;]+$/, ''); // `(a.ts, b.ts)` in a diagram
  if (/^[\w.-]+(?:\\[\w.-]+)+\\?$/.test(t)) t = t.replaceAll('\\', '/'); // `src\utils\a.ts`

  // `/users/:id`, `api/:version/items`: route patterns, not files.
  if (/(?:^|\/):[A-Za-z_]\w*(?=\/|$)/.test(t)) return { ignored: 'route' };
  // `?lastEventId` (query strings), `--vscode-*` (flags, CSS variables): not files.
  if (/^[?-]/.test(t)) return { ignored: 'not-a-reference' };
  if (!(options.origin === 'link' ? LINK_PATH_CHARS : PATH_CHARS).test(t)) return null;
  // Parentheses are only allowed as whole segments: Next.js route groups like `app/(auth)/`.
  if (/[()]/.test(t.replace(/(^|\/)\([^/()]+\)(?=\/|$)/g, '$1'))) return null;
  if (t.startsWith('//')) return null;

  const rooted = t.startsWith('/');
  const dotSlash = /^\.(?:\/|$)/.test(t);
  const dotDot = /^\.\.(?:\/|$)/.test(t);
  // Markdown links resolve against their file (as on GitHub). Elsewhere `./x` usually means
  // "from where you run commands", so it's resolved like any other path; only `../` binds to the file.
  const fromFile = options.origin === 'link' ? dotSlash || dotDot : dotDot;
  const isDir = t.endsWith('/') || options.forceDir === true;
  const isGlob = /[*?{]/.test(t);
  const body = rooted ? t.replace(/^\/+/, '') : t;

  const value = fromFile ? joinRel(ctx.fileDir, body) : normalizeRel(body);
  if (value === '..' || value.startsWith('../')) return { ignored: 'outside-repo' };
  if (value === '') return { ignored: 'not-a-reference' };

  const segments = value.split('/');
  const first = segments[0] as string;
  const base = segments[segments.length - 1] as string;
  const hasSlash = segments.length > 1 || rooted || fromFile || dotSlash;
  const ext = extensionOf(base);
  const knownExt = ext !== null && KNOWN_EXTENSIONS.has(ext);
  const wellKnown =
    WELL_KNOWN_FILES.has(base) || /^(?:Dockerfile|Containerfile|Makefile)\.[\w.-]+$/.test(base);
  const dotfile =
    base.startsWith('.') &&
    (KNOWN_DOTFILES.has(base) ||
      /^\.(?:env|eslintrc|prettierrc|stylelintrc|babelrc)(?:\.|$)/.test(base));
  const fileLike = knownExt || wellKnown || dotfile;
  // `tools/report.is_self_improvement_title`, `report.py._build`: a Python attribute, not a file.
  if (ext !== null && !knownExt && /_/.test(ext)) return { ignored: 'not-a-reference' };

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
      ...(unaliased !== undefined && unaliased !== value ? { unaliased } : {}),
    },
  });

  if (!hasSlash) {
    if (BRAND_NAMES.has(base.toLowerCase())) return { ignored: 'not-a-reference' };
    // `.ts`, `.test.ts`, `.d.ts`: extensions and suffixes, not files.
    if (base.startsWith('.') && !dotfile) return { ignored: 'not-a-reference' };
    if (ext === 'json' && METHOD_RECEIVERS.has(stemOf(base))) return { ignored: 'not-a-reference' };
    if (isGlob) {
      if (/^[*?{},.]+$/.test(base)) return { ignored: 'placeholder' };
      // Only file globs (`*.ts`, `*.test.tsx`); `get_*`, `n8n.start.*`, `*args` are identifiers.
      // Low: a bare glob that matches nothing usually names build output (`*.js.map`).
      return /\*[^/]*\.[A-Za-z0-9]+$/.test(base)
        ? shape('low', true)
        : { ignored: 'not-a-reference' };
    }
    if (isDir) return shape('medium', false); // `scripts/`
    // Bare names (`nls.messages.json`) are often build outputs or files mentioned in passing,
    // and could live anywhere: too uncertain to report by default.
    return fileLike ? shape('low', true) : null;
  }

  if (fromFile) return shape(options.origin === 'link' ? 'high' : 'medium', false);

  // `/skills`, `/settings`: an app route or URL path, not a file at the repo root.
  if (rooted && segments.length === 1 && !fileLike && !isDir) return { ignored: 'route' };
  // Rooted paths (`/inbox/*`) only mean the repo root.
  const where = rooted ? (ctx.files.exists(first) ? 'near' : null) : whereSegmentExists(ctx, first);
  const firstExists = where !== null;
  if (!firstExists) {
    if (rooted) return { ignored: SYSTEM_DIRS.has(first) ? 'system-path' : 'route' };
    const looksLike = unresolvedLooksLike(value);
    if (looksLike) return { ignored: looksLike };
  }
  // A glob into a directory that doesn't exist is usually not about files (`release/*`, `changeset/*`).
  if (isGlob) return shape(firstExists ? 'high' : 'low', false);
  // `./scripts/deploy.sh` is unmistakably a path, even if `scripts/` is gone.
  if (dotSlash && fileLike) return shape('high', false);
  // `.clai/settings.json`, `.oss-build-out/x.js`: a tool's own directory, created at run time.
  if (!firstExists && first.startsWith('.') && !REPO_DOT_DIRS.has(first))
    return shape('low', false);
  if (!firstExists) {
    // `configs/sync/`, `serving/manifest.json` when no `configs/` or `serving/` exists anywhere
    // near: API paths and object-store keys as often as stale paths. Source and doc files
    // (`src/gone.ts`) are still worth a warning.
    if (ext !== null && SOURCE_EXTENSIONS.has(ext)) return shape('medium', false);
    return shape('low', false);
  }
  if (fileLike || isDir) return shape('high', false);
  // `chat/configChanged`, `github/cli` (protocol names) in `src/vs/platform/agentHost/AGENTS.md`,
  // where `chat/` only exists further up: too weak a match for an extensionless token.
  return shape(where === 'near' ? 'medium' : 'low', false);
}

/** Extensions of files that live in a repo's source tree (not data or build output). */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  'c',
  'cc',
  'cjs',
  'cpp',
  'cs',
  'css',
  'cts',
  'ex',
  'exs',
  'go',
  'h',
  'hpp',
  'java',
  'js',
  'jsx',
  'kt',
  'md',
  'mdc',
  'mdx',
  'mjs',
  'mts',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'ts',
  'tsx',
  'vue',
]);

/** Dot-directories that live in repositories (as opposed to tool state in a home or build dir). */
const REPO_DOT_DIRS: ReadonlySet<string> = new Set([
  '.changeset',
  '.circleci',
  '.claude',
  '.context',
  '.cursor',
  '.devcontainer',
  '.github',
  '.gitlab',
  '.husky',
  '.storybook',
  '.vscode',
  '.windsurf',
]);

/**
 * Where a first path segment exists: `'near'` at the root or next to the file, `'ancestor'` only
 * in a directory in between, `null` nowhere.
 */
function whereSegmentExists(ctx: ClassifyContext, segment: string): 'near' | 'ancestor' | null {
  if (ctx.files.exists(segment) || ctx.files.exists(joinRel(ctx.fileDir, segment))) return 'near';
  for (let dir = dirnameRel(ctx.fileDir); dir !== ''; dir = dirnameRel(dir)) {
    if (ctx.files.exists(joinRel(dir, segment))) return 'ancestor';
  }
  return null;
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
