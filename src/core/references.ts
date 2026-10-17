import type { Confidence, Range } from './types.js';

// Candidates are raw snippets pulled out of markdown; references are what they turned out to be.
// See PLAN.md §5.2 (extraction) and §5.3 (classification).

export type CandidateOrigin = 'inlineCode' | 'codeBlock' | 'link' | 'import' | 'frontmatter';

export interface Candidate {
  /** The snippet: an inline code value, one logical shell line, a link URL, an import specifier… */
  raw: string;
  origin: CandidateOrigin;
  /** Repo-relative path of the file the candidate came from. */
  file: string;
  /** Range of `raw` in the file. */
  range: Range;
  /** Maps a [start, end) slice of `raw` to its range in the file. */
  locate: (start: number, end: number) => Range;
  /** Fenced code language, lowercased (code blocks and imports only). */
  lang?: string;
  /** The surrounding block's plain text and where `raw` starts in it (inline code only). */
  context?: { text: string; index: number };
  /** Frontmatter key the value came from, e.g. `globs` (frontmatter only). */
  frontmatterKey?: string;
  /** A comment above the command says it runs from the repo root (code blocks only). */
  fromRoot?: boolean;
}

interface ReferenceBase {
  confidence: Confidence;
  candidate: Candidate;
  /** Range of the referenced token itself, e.g. just `test:e2e` in `npm run test:e2e`. */
  range: Range;
}

export interface PathReference extends ReferenceBase {
  kind: 'path';
  /** Normalized POSIX path: aliases expanded, `./` and trailing `/`, `:line` and `#anchor` removed. */
  value: string;
  /** Written with a trailing slash, so it must be a directory. */
  isDir: boolean;
  isGlob: boolean;
  /** Starts with `./` or `../`: resolve against the instruction file's directory only. */
  fromFile: boolean;
  /** A bare file name without a directory (`package.json`): may live anywhere in the repo. */
  bare: boolean;
  /** Written with a leading `/`, which we read as the repo root. */
  rooted: boolean;
  anchor?: string;
  /**
   * The path as written, when a plain-word tsconfig alias (`lib/*`, `scenes/*`) rewrote it:
   * `lib/github.ts` may be the alias or a real `lib/` next to the file, so both are tried.
   */
  unaliased?: string;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** A package.json script run through a package manager (or `node --run`). */
export interface ScriptReference extends ReferenceBase {
  kind: 'script';
  tool: PackageManager | 'node';
  name: string;
  /** Workspace selector (`--filter`, `-w`, `yarn workspace <name>`), unresolved. */
  workspace?: string;
  /** Runs in every workspace (`pnpm -r`, `npm --workspaces`, `yarn workspaces foreach`). */
  recursive?: boolean;
  /** Directory the command runs in (`--prefix`, `-C`, `--cwd`), repo-relative. */
  dir?: string;
  /** `--if-present`: a missing script is fine. */
  ifPresent?: boolean;
  /** The package manager falls back to running a binary of that name (`pnpm tsc`, `yarn jest`). */
  orBin?: boolean;
}

/** A Make target or just recipe. */
export interface TargetReference extends ReferenceBase {
  kind: 'target';
  tool: 'make' | 'just';
  name: string;
  /** `make -C dir` / `just -d dir`. */
  dir?: string;
  /** `make -f file` / `just -f file`. */
  file?: string;
}

/** An executable expected in node_modules/.bin (`npx`, `pnpm exec`, `bunx`, `yarn <bin>`). */
export interface BinReference extends ReferenceBase {
  kind: 'bin';
  tool: PackageManager;
  name: string;
}

export interface PackageReference extends ReferenceBase {
  kind: 'package';
  name: string;
  ecosystem: 'npm';
  /** Mentioned as something *not* to use ("instead of `moment`"): it need not be installed. */
  negated: boolean;
}

export type Reference =
  | PathReference
  | ScriptReference
  | TargetReference
  | BinReference
  | PackageReference;

export type ReferenceKind = Reference['kind'];

export type IgnoreReason =
  | 'url'
  | 'email'
  | 'placeholder'
  | 'route'
  | 'mime'
  | 'number'
  | 'git-ref'
  | 'system-path'
  | 'outside-repo'
  | 'alias'
  | 'user-pattern'
  | 'unverifiable-tool'
  | 'not-a-reference';

export interface Ignored {
  kind: 'ignored';
  reason: IgnoreReason;
  candidate: Candidate;
}

export type Classification = Reference | Ignored;
