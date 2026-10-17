import type { IgnoreReason } from '../../core/references.js';

// Tokens that are never references, whatever else they look like (PLAN.md §5.3 A).
// These run before path and package classification.

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const PSEUDO_SCHEME =
  /^(?:mailto|tel|data|javascript|about|file|npm|jsr|node|git\+ssh|ssh|s3|gs|urn):/i;
const SCP_LIKE = /^[\w.-]+@[\w.-]+:[\w./~-]/;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/i;
const HOST_PORT = /^(?:localhost|[\w-]+(?:\.[\w-]+)+|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:[/?#]|$)/i;
// Domains: `www.x`, `host.tld/path`, or a bare `host.tld` with an unambiguous TLD. Lowercase
// only, and TLDs that double as file extensions (`.sh`, `.md`) are left out, so `deploy.sh`
// and `Dockerfile.dev` stay files.
const DOMAIN_WITH_PATH =
  /^(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|me|gg|xyz|cloud|so|us|uk|de|fr|jp|info|tech|site|page|run|link)[/:?#]/;
const BARE_DOMAIN = /^(?:www\.[a-z0-9.-]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|co))$/;

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /[<>]/, // <id>, <your-file>
  /\{\{|\}\}/, // {{name}}
  /\$\{|\$[A-Za-z_(]/, // ${VAR}, $HOME/x, $(cmd)
  /%[A-Za-z_]+%/, // %APPDATA%
  /\.{3}|…/, // src/.../x
  /(?:^|\/)path\/to(?:\/|$)/i, // path/to/file
  /\{[^,{}]*\}/, // {domain}, {provider}: a placeholder (brace expansion needs a comma)
];

/** Segment stems that are placeholders ("foo/bar.ts", "your-app/", "my-component.tsx", "skill-name/"). */
const PLACEHOLDER_SEGMENT =
  /^(?:foo|bar|baz|qux|quux|x{3,}|placeholder|example|sample|some[-_]?(?:file|dir|folder|path|thing|module|package)?|your[-_][\w-]+|my[-_][\w-]+|[a-z]+[-_]name)$/i;
/** `YourService.node.ts`, `MyComponent.tsx`: case-sensitive, so `mypy` and `yourls` are fine. */
const PLACEHOLDER_PREFIX = /^(?:Your|My)[A-Z]/;
/** `signals-scout-foo/`, `0NNN_add_index.py`, `XXXX-slug.md`: a placeholder inside a name. */
const PLACEHOLDER_PART =
  /(?:^|[-_])(?:foo|bar|baz)(?:$|[-_.])|(?:^|[^A-Za-z])(?:N{3,}|X{3,})(?:$|[^A-Za-z])/;

const VERSION = /^[v^~>=<]*\d+(?:\.(?:\d+|x|\*))+(?:[-+][\w.]+)?$/i;
const NUMERIC = /^(?=.*\d)[\d.,:/-]+$/;
const GIT_REF = /^(?:(?:origin|upstream|refs|remotes)\/|HEAD(?:[~^]\d*)*$)/;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/** Why `token` should be ignored, or `null` if it may be a reference. */
export function ignoreReason(token: string): IgnoreReason | null {
  if (URL_SCHEME.test(token) || PSEUDO_SCHEME.test(token) || SCP_LIKE.test(token)) return 'url';
  if (EMAIL.test(token)) return 'email';
  if (HOST_PORT.test(token) || DOMAIN_WITH_PATH.test(token) || BARE_DOMAIN.test(token)) {
    return 'url';
  }
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(token))) return 'placeholder';
  if (hasPlaceholderSegment(token)) return 'placeholder';
  if (VERSION.test(token) || NUMERIC.test(token)) return 'number';
  if (GIT_REF.test(token)) return 'git-ref';
  if (token === '~' || token.startsWith('~/') || WINDOWS_ABSOLUTE.test(token)) return 'system-path';
  return null;
}

function hasPlaceholderSegment(token: string): boolean {
  return token
    .split('/')
    .some(
      (segment) =>
        segment !== '' &&
        (PLACEHOLDER_SEGMENT.test(stem(segment)) ||
          PLACEHOLDER_PREFIX.test(segment) ||
          PLACEHOLDER_PART.test(segment)),
    );
}

function stem(segment: string): string {
  const dot = segment.indexOf('.', 1);
  return dot === -1 ? segment : segment.slice(0, dot);
}

// Checked only when a path's first segment doesn't exist in the repo, because real directories
// can have these names.

const MIME = /^(?:application|text|image|audio|video|font|multipart|model|message)\/[\w.+*-]+$/i;
const BRANCH = /^(?:feature|feat|fix|bugfix|hotfix|release|chore|docs|refactor)\/[\w.-]+$/;

export function unresolvedLooksLike(token: string): IgnoreReason | null {
  if (MIME.test(token)) return 'mime';
  if (BRANCH.test(token)) return 'git-ref';
  return null;
}
