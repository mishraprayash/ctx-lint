# ctx-lint — Build Plan

> Context Linter & Sync for AI Coding Agents.
> This document is the source of truth for building `ctx-lint`. Work through the phases in order; each phase ends with concrete acceptance criteria. Update the **Decision Log** at the bottom whenever a decision here changes.

---

## 1. Product Summary

### 1.1 The problem
Teams use several AI coding agents at once (Claude Code, Cursor, Codex/OpenCode, Windsurf, GitHub Copilot), and each one reads its own instruction file:

| Agent | Files it reads |
|---|---|
| Claude Code | `CLAUDE.md` (root + nested), `.claude/CLAUDE.md` |
| Codex / OpenCode / Amp / generic | `AGENTS.md` (root + nested) |
| Cursor | `.cursor/rules/*.mdc`, legacy `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` |
| Windsurf | `.windsurf/rules/*.md`, legacy `.windsurfrules` |

These files have two problems:

1. **Duplication / drift**: the same rules are copy-pasted into 3–5 files, then edited in one and not the others.
2. **Context rot**: they point at files that were deleted or renamed, scripts that no longer exist, and libraries that were removed. Agents trust these files, so they hallucinate, run commands that fail, and burn tokens.

### 1.2 What we build
A fast CLI that never calls an LLM, with three commands:

| Command | Job |
|---|---|
| `ctx-lint check` | Lint instruction files for broken paths, missing scripts/targets, and missing dependencies. Output looks like ESLint. Exits non-zero on errors, so it can gate CI. |
| `ctx-lint sync` | Compile one source of truth (`.context/rules/*.md`) into each agent's native format. |
| `ctx-lint audit` | Estimate token cost per file and per agent, and warn when the always-on baseline is over budget. |

Plus supporting commands: `ctx-lint init` (scaffold or import) and `ctx-lint explain <rule>`.

### 1.3 Design principles
1. **Precision over recall.** A linter that cries wolf gets uninstalled. When we're unsure whether something is a path, we skip it or downgrade it to a warning. Never raise an error on low confidence.
2. **Zero config to start, configurable to scale.** `npx ctx-lint check` must be useful in any repo with no setup at all.
3. **Offline and deterministic.** No network calls, no LLMs, and the same input always gives the same output (stable ordering, no timestamps in generated files).
4. **Fast.** Index the filesystem once and look things up in O(1). Target under 300 ms on a typical repo and under 2 s on a large monorepo.
5. **Non-destructive.** `sync` never overwrites a file it didn't generate unless `--force` is passed. Hand-written content can live next to generated content.
6. **Pluggable internals.** Agent targets, manifest providers (npm, make, …), rules and reporters are all interfaces with a registry, so contributors can add one without touching the core.
7. **CI-native.** Stable exit codes, plus JSON, SARIF and GitHub-annotation output, a published GitHub Action, and a pre-commit hook.

### 1.4 Non-goals (v1)
- Judging rule *quality* with an LLM.
- Editing or "fixing" prose. The only auto-fix is replacing a path that we know was renamed.
- Full Makefile/shell semantics. We parse well enough for target and script names, nothing more.
- Exact Claude token counts. Anthropic's tokenizer isn't available offline, so we estimate and say so.

---

## 2. Tech Stack

### 2.1 Decision: TypeScript on Node.js (≥ 22.12), ESM-only

**Why TypeScript over Go:**
- **Distribution where the users already are.** Almost every repo that has `package.json` scripts already has Node, so `npx ctx-lint check` works with nothing to install. Most target users live in the JS/TS ecosystem.
- **Best-in-class Markdown tooling.** The `mdast`/`micromark` ecosystem gives a spec-compliant CommonMark + GFM AST with exact line/column positions, which we need for ESLint-style reports. Go's options are weaker here.
- **Contributor pool.** People who write agent rules overwhelmingly know TS, so it's easier for them to contribute rules and targets.
- **Programmatic API.** Other JS tools (editor extensions, Husky hooks, other CLIs) can `import { check } from 'ctx-lint'`.
- **Escape hatch for non-Node users:** standalone binaries via `bun build --compile` (Phase 7), shipped through GitHub Releases and Homebrew.

**Trade-off we accept:** Node startup costs about 50 ms more than a Go binary. That's irrelevant for a linter.

### 2.2 Dependencies (keep runtime deps small and audited)

| Concern | Choice | Reason |
|---|---|---|
| CLI framework | `commander` | Mature, typed, has subcommands and good help output. |
| Colors | `picocolors` | Same idea as chalk but ~14× smaller with no deps. Respects `NO_COLOR`/`FORCE_COLOR`. |
| Markdown AST | `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm` + `micromark-extension-frontmatter` + `mdast-util-frontmatter` | Exact positions, GFM tables/task lists, frontmatter as a node. |
| YAML | `yaml` | Good error positions; stringifies deterministically for generated frontmatter. |
| Schema validation | `zod` (v4) | Validates config and frontmatter; `z.toJSONSchema()` generates the published JSON Schema. |
| Glob matching | `picomatch` | Globs are matched against the in-memory `FileIndex`, so no separate globbing library is needed. |
| Config parsing | `jsonc-parser` | Lets `.context/config.json` contain comments and trailing commas, with error offsets. |
| Gitignore | `ignore` | Respects `.gitignore` when building the file index. |
| Fuzzy suggestions | `fastest-levenshtein` | "Did you mean …?" for renamed files and scripts. |
| Exact tokenizer (optional) | `gpt-tokenizer` (lazy-loaded, optional dep) | Pure JS, offline, o200k/cl100k. The default is a heuristic, so this never loads unless asked for. |

**Dev tooling:**

| Concern | Choice |
|---|---|
| Build | `tsup` (esbuild). Outputs `dist/cli.js` and `dist/index.js` plus `.d.ts` files. |
| Test | `vitest` with v8 coverage |
| Lint/format | `biome` (one fast tool instead of eslint + prettier) |
| Type check | TypeScript **6.x** (`tsc --noEmit`; TS 7's native compiler has no JS API yet, which tsup's dts bundler needs) with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| E2E | `execa` runs the built CLI against fixture repos |
| Scripts | `tsx` runs TS scripts such as `pnpm schema` (regenerates `schema/config.schema.json`) |
| Release | `changesets` + GitHub Actions publishing to npm with `--provenance` |
| Package manager | `pnpm` (lockfile committed), with `packageManager` pinned via Corepack |

> ⚠️ Before Phase 7, check that the `ctx-lint` name is free on npm. Fallbacks: `@ctx-lint/cli`, `ctxlint`.

---

## 3. Architecture

### 3.1 Pipeline overview

```
                ┌──────────────────────────────────────────────────────────┐
                │                       ProjectContext                      │
                │  root · FileIndex · Manifests (npm, make, just, …) · Config│
                └──────────────────────────────────────────────────────────┘
                                ▲                ▲               ▲
 check:  Discover ──► Parse ──► Extract ──► Classify ──► Rules ──► Reporter ──► exit code
          (targets)   (mdast)   (candidates) (Reference)  (Diagnostics)

 sync:   Load .context/rules ──► Validate ──► IR (Rule[]) ──► Target compilers ──► Writer (diff/check/write)

 audit:  Discover + (optionally) sync IR ──► Tokenizer ──► Baseline per agent ──► Budget report
```

`check` and `audit` share **discovery**. `sync` and `audit` share the **rule IR**. Every stage is a pure function over data, except the writer and the `FileIndex` builder at the edges, which are the only parts that touch the filesystem.

### 3.2 Modules and responsibilities

| Module | Responsibility | Depends on |
|---|---|---|
| `core/` | Shared types (`Diagnostic`, `Reference`, `SourceFile`, `Position`), errors, logger, `ProjectContext` | — |
| `config/` | Load `.context/config.json`, merge defaults with CLI flags, validate with zod, export the JSON Schema | core |
| `fs/` | `FileIndex`: one walk of the repo (respects `.gitignore` and the default ignores), case-exact lookup, glob matching, basename index for suggestions | core |
| `discovery/` | Find instruction files using the target registry's `detect` globs | core, fs, targets |
| `parsers/markdown` | Markdown → mdast with positions; frontmatter extraction | core |
| `parsers/extract` | Walk the mdast → raw `Candidate`s (inline code, fenced code, links), skipping disabled regions | parsers/markdown |
| `parsers/classify` | `Candidate` → typed `Reference` (`path` / `command` / `package` / `ignored`) with a confidence score | core |
| `manifests/` | `ManifestProvider` interface + providers: `npm` (package.json + workspaces + lockfile → PM), `make`, `just` (later: `pyproject`, `cargo`, `go`) | core, fs |
| `linter/` | Rule engine: run rules over references, apply severity config and inline disables, collect diagnostics | core, manifests, fs |
| `linter/rules/*` | One file per rule (see §5.4) | linter |
| `reporters/` | `stylish` (default), `json`, `sarif`, `github` (workflow annotations), `compact` | core |
| `targets/` | `TargetAdapter` per agent: **detect** (which files it reads), **parse** (for check/audit), **compile** (for sync) | core, parsers |
| `syncer/` | Load source rules → IR → call target compilers → plan writes → write / dry-run / check | targets, config, fs |
| `auditor/` | Tokenizer abstraction, baseline computation per agent, budget checks, table reporter | targets, syncer (IR) |
| `cli/` | Commander wiring only: parse flags, call the API, print, set exit code. **No business logic.** | everything above via `api/` |
| `api/` | Public programmatic API: `check()`, `sync()`, `audit()`, `init()` | everything |

**Rule of thumb:** `cli/` is thin. Everything the CLI can do is also exported from `api/` and covered by tests at that level.

### 3.3 Core types (sketch)

```ts
// core/types.ts
export type Severity = 'error' | 'warn' | 'off';

export interface Position { line: number; column: number; offset: number } // 1-based line/col
export interface Range { start: Position; end: Position }

export interface SourceFile {
  path: string;              // repo-relative, POSIX separators
  absPath: string;
  agent: AgentId[];          // which agents read this file
  content: string;
  frontmatter?: Record<string, unknown>;
  generated?: GeneratedHeader; // set if produced by `ctx-lint sync`
}

export type CandidateOrigin = 'inlineCode' | 'codeBlock' | 'link' | 'frontmatter';
export interface Candidate {
  raw: string;
  origin: CandidateOrigin;
  lang?: string;             // fenced code language
  range: Range;
  context: string;           // the surrounding sentence, used by the package heuristic
  file: SourceFile;
}

export type Reference =
  | { kind: 'path'; value: string; isDir: boolean; isGlob: boolean; anchor?: string; confidence: Confidence; candidate: Candidate }
  | { kind: 'command'; tool: CommandTool; script: string; workspace?: string; confidence: Confidence; candidate: Candidate }
  | { kind: 'package'; name: string; ecosystem: 'npm'; confidence: Confidence; candidate: Candidate };

export type Confidence = 'high' | 'medium' | 'low';

export interface Diagnostic {
  ruleId: string;            // e.g. 'path-exists'
  severity: Exclude<Severity, 'off'>;
  message: string;
  file: string;
  range: Range;
  suggestion?: { message: string; replacement?: string }; // powers --fix and "did you mean"
}
```

```ts
// linter/rule.ts
export interface LintRule {
  id: string;
  meta: { description: string; defaultSeverity: Severity; docsUrl: string; fixable?: boolean };
  appliesTo: Reference['kind'][] | 'file';
  check(ref: Reference | SourceFile, ctx: ProjectContext, report: (d: Omit<Diagnostic, 'ruleId' | 'severity'>) => void): void;
}
```

```ts
// targets/adapter.ts
export interface TargetAdapter {
  id: AgentId;                          // 'claude' | 'agents' | 'cursor' | 'copilot' | 'windsurf'
  displayName: string;
  detect: string[];                     // globs of files this agent reads
  isAlwaysOn(file: SourceFile): boolean; // used by audit (e.g. a Cursor rule with alwaysApply: true)
  compile(rules: RuleIR[], opts: TargetOptions): OutputFile[];
}

// manifests/provider.ts
export interface ManifestProvider {
  id: 'npm' | 'make' | 'just' | string;
  load(ctx: ProjectContext): Promise<Manifest | null>; // null means not present in this repo
}
export interface Manifest {
  scripts: Map<string, ScriptInfo>;     // name → defined in which file (+ workspace)
  dependencies?: Map<string, DepInfo>;  // name → version, kind (dev/peer/…), workspace
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
}
```

### 3.4 Repository layout

```
ctx-lint/
├── src/
│   ├── cli/
│   │   ├── index.ts              # bin entry: commander program
│   │   ├── commands/{check,sync,audit,init,explain}.ts
│   │   └── exit-codes.ts
│   ├── api/index.ts              # public exports
│   ├── core/{types,errors,logger,context,position}.ts
│   ├── config/{schema,load,defaults}.ts
│   ├── fs/{file-index,walk,glob}.ts
│   ├── discovery/index.ts
│   ├── parsers/
│   │   ├── markdown.ts
│   │   ├── frontmatter.ts
│   │   ├── extract.ts
│   │   ├── disable-comments.ts
│   │   ├── classify/
│   │   │   ├── index.ts
│   │   │   ├── path.ts
│   │   │   ├── command.ts
│   │   │   ├── package.ts
│   │   │   └── ignore-patterns.ts  # URLs, placeholders, mime types, routes …
│   │   └── shell.ts                # tiny shell-line tokenizer (env prefixes, &&, |, ;)
│   ├── manifests/{provider,registry,npm,make,just}.ts
│   ├── linter/
│   │   ├── engine.ts
│   │   ├── rule.ts
│   │   └── rules/{path-exists,path-case,glob-matches,link-anchor,script-exists,
│   │              make-target-exists,package-manager-mismatch,dependency-installed,
│   │              frontmatter-valid,generated-file-modified}.ts
│   ├── reporters/{stylish,json,sarif,github,compact,index}.ts
│   ├── targets/{adapter,registry,claude,agents,cursor,copilot,windsurf}.ts
│   ├── syncer/{load-sources,ir,plan,write,header,managed-block}.ts
│   └── auditor/{tokenizer,heuristic,baseline,report}.ts
├── test/
│   ├── unit/…                    # mirrors src/
│   ├── fixtures/
│   │   ├── basic-npm/            # tiny repo: package.json, CLAUDE.md with good and bad refs
│   │   ├── pnpm-monorepo/
│   │   ├── makefile-only/
│   │   ├── false-positives/      # URLs, placeholders, routes, mime types → must give 0 diagnostics
│   │   ├── sync-source/          # .context/ input + expected/ output snapshots
│   │   └── audit-budget/
│   └── e2e/cli.test.ts
├── examples/
│   └── demo/                     # the deliverable demo (see §9)
├── schema/config.schema.json     # generated from zod; published for editor autocomplete
├── docs/
│   ├── rules/<rule-id>.md        # one page per rule (linked from docsUrl)
│   ├── targets.md
│   ├── configuration.md
│   └── ci.md
├── action.yml                    # GitHub Action (composite: setup-node + npx ctx-lint)
├── .pre-commit-hooks.yaml
├── .github/
│   ├── workflows/{ci,release}.yml
│   ├── ISSUE_TEMPLATE/{bug,false_positive,new_target}.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── .changeset/
├── biome.json · tsconfig.json · tsup.config.ts · vitest.config.ts · package.json
├── README.md · CONTRIBUTING.md · CODE_OF_CONDUCT.md · SECURITY.md · CHANGELOG.md · LICENSE (MIT)
└── PLAN.md
```

---

## 4. Configuration

### 4.1 `.context/config.json`

Every field is optional. With no config file, `check` and `audit` use the defaults below, and `sync` explains that it needs a config and suggests running `ctx-lint init`.

```jsonc
{
  "$schema": "https://unpkg.com/ctx-lint/schema/config.schema.json",

  // ---- sync ----
  "sources": ".context/rules",            // directory of source rule files
  "targets": {
    "claude":   { "enabled": true,  "output": "CLAUDE.md", "scopedRules": "sections" },  // sections | nested
    "agents":   { "enabled": true,  "output": "AGENTS.md", "scopedRules": "sections" },
    "cursor":   { "enabled": true,  "outputDir": ".cursor/rules" },
    "copilot":  { "enabled": true,  "output": ".github/copilot-instructions.md", "scopedRules": "instructions" }, // instructions | sections
    "windsurf": { "enabled": false, "outputDir": ".windsurf/rules" }
  },
  "mode": "managed-block",                // "file" (own the whole file) | "managed-block" (only between markers)

  // ---- check ----
  "check": {
    "include": [],                        // extra files to lint (globs), e.g. "docs/agents/*.md"
    "exclude": [],
    "rules": {
      "path-exists": "error",
      "dependency-installed": "warn",
      "package-manager-mismatch": "warn"
    },
    "ignorePaths": ["dist/**", "build/**", ".env*", "coverage/**"],  // generated/gitignored paths that may legitimately be missing
    "ignorePatterns": [],                 // extra regexes for candidates to skip
    "aliases": { "@/": "src/" },          // import aliases used in docs (also read from tsconfig paths)
    "minConfidence": "medium"             // candidates below this confidence are skipped
  },

  // ---- audit ----
  "audit": {
    "tokenizer": "heuristic",             // heuristic | o200k | cl100k
    "budget": { "default": 2500, "claude": 3000 },  // always-on tokens per agent
    "fileWarn": 1500                      // warn when a single file is bigger than this
  }
}
```

### 4.2 Precedence
CLI flags > `.context/config.json` > built-in defaults. `--config <path>` overrides where the config is loaded from. Config is validated with zod, and validation errors are printed with the JSON path, e.g. `targets.cursor.outputDir: expected string`. They exit with code 2.

### 4.3 Inline controls (inside any instruction file)
```md
<!-- ctx-lint-disable-next-line path-exists -->
<!-- ctx-lint-disable dependency-installed -->  …  <!-- ctx-lint-enable dependency-installed -->
<!-- ctx-lint-disable -->                        (disables all rules until the matching enable)
<!-- ctx-lint-disable-line -->                   (same line, e.g. at the end of a bullet)
<!-- ctx-lint-disable path-exists -- reason -->  (text after " -- " is a free-form reason)
```
These are HTML comments, so agents don't see them as instructions. A disable comment that suppresses nothing is reported as a warning (`unused-disable`), like ESLint's `--report-unused-disable-directives`.

---

## 5. `ctx-lint check` — Detailed Design

### 5.1 Discovery
1. Build the `FileIndex`: walk from the repo root (the nearest `.git` dir, or `--cwd`), honour `.gitignore` plus the default ignores (`node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `vendor`, `.venv`), and store a `Set` of POSIX-relative paths, a `Set` of directories, and a `basename → paths[]` map.
2. Collect instruction files with the union of every `TargetAdapter.detect` glob, plus `check.include`, minus `check.exclude`. Explicit CLI file args (`ctx-lint check CLAUDE.md`) replace discovery.
3. Tag each file with the agent(s) that read it (used by the reporters and by audit).

> **Gitignored and heavy directories (as built):** the index walks everything except *opaque* directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `target`, `.venv` … (`DEFAULT_OPAQUE_DIRS`), gitignored directories, and symlinked directories. Opaque directories are recorded but not walked, and paths below them are resolved lazily on disk, one `readdir` per segment, so the lookup stays case-exact. Gitignored *files* are indexed and flagged `ignored`, so a doc mentioning a present-but-ignored `.env.local` still resolves. Paths that may legitimately be missing (build output, `.env*`) are skipped via `check.ignorePaths`.

### 5.2 Extraction (parse → candidates)
Walk the mdast:

| Node | What we extract |
|---|---|
| `inlineCode` | Whole value as one candidate (`src/auth/guards/`, `pnpm build`, `zod`) |
| `code` (fenced) with lang in `sh, bash, zsh, shell, console, terminal, ps1` or no lang | Each logical line (handling `\` continuations); strip `$ ` / `> ` prompts. In `console` blocks, only lines that start with a prompt count. Lines are command candidates only. |
| `code` with other langs (`ts`, `js`, `py` …) | Only `import … from '<pkg>'` / `require('<pkg>')` specifiers → package candidates. Everything else in code blocks is ignored (it's "generic code"). |
| `link` / `definition` with a relative URL | Path candidate (+ `#anchor`) |
| `html` comments | Read for disable directives only |

Each candidate keeps its exact range. For multi-line fenced blocks, ranges are computed per line from the block start, so line numbers in the report are exact.

### 5.3 Classification (candidate → reference)
This is the core quality problem. Classify in this order; the first match wins.

**A. Ignore (never reported)** — `ignore-patterns.ts`:
- URLs and URIs: `://`, `www.`, `mailto:`, `data:`, emails, `localhost:3000`
- Placeholders: `path/to/…`, `<anything>`, `{{…}}`, `${…}`, `$VAR`, `%VAR%`, `…`/`...`, `your-…`, `my-…`, `example…`, `foo`/`bar`/`baz` segments, `xxx`, `*` on its own
- HTTP routes: leading `/` with a `:param` segment or `/api/` prefix, unless the path actually exists
- MIME types (`application/json`, `text/*`), dates (`1/2/2024`), fractions, `and/or`, `input/output`, `true/false`
- Git refs: `origin/main`, `feature/…`, `refs/…`, `HEAD~1`
- Absolute system paths outside the repo: `/usr/…`, `/etc/…`, `~/…`, `C:\…`
- Anything matching `check.ignorePatterns`

**B. Command**: the first shell token (after stripping env assignments like `CI=1` and splitting on `&&`, `||`, `;`, `|`) is one of:
- `npm run <s>` / `npm run-script <s>` / `npm <builtin>` where `test|start|stop|restart` map to scripts
- `pnpm <s>` / `pnpm run <s>`, with `--filter <pkg>` / `-F` → workspace. Bare `pnpm <x>` is a script only when `<x>` isn't a pnpm built-in (`install`, `add`, `dlx`, `exec`, …).
- `yarn <s>` / `yarn run <s>` / `yarn workspace <pkg> <s>` (same built-in exclusion list)
- `bun run <s>` (bare `bun <x>` is a script when it isn't a built-in or a file path)
- `npm run <s> -w <pkg>` / `--workspace`
- `make <target…>` (flags such as `-C dir` change the Makefile location), `just <recipe>`
- `npx <bin>` / `pnpm exec <bin>` → bin check (`medium` confidence, warning)
- Known-but-unverifiable tools (`turbo run`, `nx run`, `docker compose`) → treated as `ignored` in v1

**C. Path**:
- `high` confidence: starts with `./` or `../`, OR ends with `/`, OR has a known file extension (`.ts .tsx .js .mjs .cjs .json .md .mdc .yml .yaml .toml .sh .py .go .rs .sql .prisma .env …`), OR is a well-known extensionless file (`Makefile`, `Dockerfile`, `Justfile`, `LICENSE`, `Procfile`, dotfiles such as `.nvmrc`).
- `medium` confidence: contains `/`, has no spaces, and **its first segment exists in the repo** (e.g. `src/auth/guards`). This is what catches renames inside real directories while ignoring `and/or`-style noise.
- `low` confidence: everything else that contains `/` → skipped by default.
- Glob characters (`*`, `**`, `?`, `{a,b}`) → `isGlob: true`.
- Next.js-style `[slug]` / `(group)` segments are **literal paths**, not placeholders.
- Resolution order: (1) relative to the instruction file's own directory if it starts with `./` or `../`, (2) relative to the repo root, (3) relative to the instruction file's directory. Aliases from config / `tsconfig.json` `compilerOptions.paths` are expanded first.

**D. Package**: a bare token matching the npm name grammar (`^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`), and one of:
- it comes from an `import`/`require` specifier in a code block (`high`), OR
- the surrounding sentence contains a library cue within ~6 words: `use`, `using`, `library`, `package`, `dependency`, `install`, `import`, `via`, `with`, `prefer`, `instead of`, `powered by` (`medium`).
- Excluded: Node built-ins (`fs`, `node:*` …), anything already classified as a path or command, and very common English or code words (`true`, `null`, `index`, `test` …) from a stoplist.
- `instead of X` / `don't use X` / `avoid X` / `deprecated` context → **flip the expectation**: a mention that warns against a package should *not* require it to be installed (and may optionally warn if it *is* installed, but that's off by default).

### 5.4 Rules (v1)

| Rule ID | Default | Checks | Example message |
|---|---|---|---|
| `path-exists` | error | Path reference resolves to an existing file or dir (a trailing `/` must be a dir) | `Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard/"?` |
| `path-case` | error | Exists case-insensitively but not with exact case (breaks on Linux CI, but passes on macOS) | `"src/Utils/date.ts" differs in case from "src/utils/date.ts"` |
| `glob-matches` | warn | Glob matches at least one file in the index | `Glob "src/**/*.vue" matches no files` |
| `link-anchor` | warn | `[x](docs/a.md#setup)`: the target file has that heading slug | `Heading "#setup" not found in docs/a.md` |
| `script-exists` | error | npm/pnpm/yarn/bun script exists in the right workspace's `package.json` | `Script "test:e2e" is not defined in package.json. Available: test, test:unit, lint` |
| `make-target-exists` | error | Make/just target exists | `Make target "migrate" not found in Makefile` |
| `bin-exists` | warn | `npx foo` resolves to a dependency that ships a `bin` | `"npx vitest": vitest is not a dependency` |
| `package-manager-mismatch` | warn | Docs say `npm run x` but the repo uses `pnpm-lock.yaml` / `packageManager: pnpm@…` | `Repo uses pnpm but this command uses npm` |
| `dependency-installed` | warn | Package reference is in some workspace's deps/devDeps/peer/optional | `"zod" is referenced as a library but isn't in any package.json` |
| `frontmatter-valid` | error | `.mdc`, `.instructions.md`, `.windsurf` and source rules: YAML parses and the keys/types are valid for that target | `.cursor/rules/api.mdc:3 "globs" must be a string or string[]` |
| `generated-file-modified` | warn | A generated file's content hash doesn't match its header (someone edited it by hand) | `CLAUDE.md was edited manually; changes will be lost on next sync` |
| `unused-disable` | warn | A disable directive that suppressed nothing | — |

**Suggestions**: for missing paths, look up the basename in the index (an exact basename found elsewhere means "probably moved"), then fall back to Levenshtein ≤ 2 over sibling entries of the deepest existing ancestor. For scripts, use Levenshtein over script names. Optional (Phase 6): `git log --diff-filter=R --name-status` to say *"renamed to X in a1b2c3d"*.

**`--fix`**: only applies a suggestion that is unique and high-confidence (an exact basename match at one location, or a git-detected rename). It rewrites the reference in place, never touches generated files (it tells the user to edit the source rule instead), and prints a summary.

### 5.5 Output

**`stylish` (default)**, modelled on ESLint:
```
CLAUDE.md
   12:5   error    Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard/"?   path-exists
   27:3   error    Script "test:e2e" is not defined in package.json                         script-exists
   41:18  warning  "zod" is referenced as a library but isn't in any package.json           dependency-installed

.cursor/rules/api.mdc
    3:1   error    "globs" must be a string or string[]                                      frontmatter-valid

✖ 4 problems (3 errors, 1 warning)
  1 fixable with --fix
```
Paths are clickable (`file:line:col`) in VS Code and most terminals.

**Other formats**: `--format json` (stable, documented schema, includes `version`), `--format sarif` (SARIF 2.1.0 for GitHub code scanning), `--format github` (`::error file=…,line=…::msg` annotations), `--format compact`.

### 5.6 Exit codes (shared by all commands)
| Code | Meaning |
|---|---|
| 0 | No errors (warnings allowed unless `--max-warnings` is exceeded) |
| 1 | Lint errors / budget exceeded / `sync --check` found drift |
| 2 | Usage or config error, or an unexpected crash (message + `--debug` hint) |

### 5.7 CLI surface
```
ctx-lint check [files...]
  --format <stylish|json|sarif|github|compact>   (default: stylish; always explicit, never auto-detected)
  --max-warnings <n>        exit 1 if warnings > n
  --quiet                   report errors only
  --fix                     apply safe fixes
  --rule <id=severity>      override a rule (repeatable)
  --no-deps                 skip dependency checks
  --cwd <dir>  --config <path>  --no-color  --debug
```

---

## 6. `ctx-lint sync` — Detailed Design

### 6.1 Source format: `.context/rules/*.md`
```md
---
description: API route conventions          # required when alwaysApply is false and globs is empty
globs: ["src/api/**/*.ts"]                   # string | string[]; optional
alwaysApply: false                           # default: true if no globs, else false
targets: ["claude", "cursor"]                # optional allow-list; default: all enabled targets
priority: 10                                 # optional ordering; lower first; ties broken by filename
---
- Validate every request body with `zod`.
- Route handlers live in `src/api/routes/`.
```
- Sources are linted by `check` too (they are where fixes belong).
- Subdirectories are allowed (`.context/rules/backend/api.md`), and the rule id is the relative path without the extension (`backend/api`).

**Rule kinds (derived):**
| Kind | Condition |
|---|---|
| `always` | `alwaysApply: true` |
| `scoped` | has `globs`, `alwaysApply: false` |
| `on-demand` | no globs, `alwaysApply: false`, has `description` (the agent decides when to load it) |

### 6.2 IR
```ts
interface RuleIR {
  id: string;               // 'backend/api'
  kind: 'always' | 'scoped' | 'on-demand';
  description?: string;
  globs: string[];
  body: string;             // markdown, trimmed, frontmatter stripped
  targets: AgentId[];
  priority: number;
  sourcePath: string;
}
```

### 6.3 Target compilation rules

| Target | `always` | `scoped` | `on-demand` |
|---|---|---|---|
| **Cursor** `.cursor/rules/<id>.mdc` | `alwaysApply: true` | `globs: <comma-joined>`, `alwaysApply: false` | `description: …`, `alwaysApply: false` (agent-requested) |
| **Claude** `CLAUDE.md` | Inlined at the top, in priority order | `sections` mode: `## Rules for \`src/api/**\`` section under "Path-specific rules". `nested` mode: written to `<static-glob-prefix>/CLAUDE.md` when the glob has a static directory prefix, otherwise falls back to a section | Section "## Optional guidance" with the description as a lead-in |
| **AGENTS.md** | Same as Claude | Same as Claude (nested `AGENTS.md` is also supported by Codex et al.) | Same as Claude |
| **Copilot** | Inlined into `.github/copilot-instructions.md` | `instructions` mode: `.github/instructions/<id>.instructions.md` with `applyTo: "<globs>"` frontmatter. `sections` mode: inlined as a section | Inlined as a section with its description |
| **Windsurf** `.windsurf/rules/<id>.md` | `trigger: always_on` | `trigger: glob`, `globs: …` | `trigger: model_decision`, `description: …` |

> Each target's frontmatter format must be checked against the vendor's current docs while implementing Phase 4, and the doc URL and date recorded in `docs/targets.md`. Vendors change these formats. Keep every format detail inside its adapter so updates stay local.

### 6.4 Generated-file header
- Markdown targets (header at the very top):
  ```md
  <!-- Generated by ctx-lint from .context/rules — DO NOT EDIT. Run `npx ctx-lint sync` to update. hash:sha256:9f2c…(12 chars) -->
  ```
- Files with frontmatter (`.mdc`, `.instructions.md`, Windsurf): **frontmatter must stay first**, so the header goes right after the closing `---`.
- `hash` = sha256 of the generated body (everything after the header). `check`'s `generated-file-modified` rule recomputes it to detect hand edits.
- No timestamps, so output is deterministic and won't cause noisy diffs.

### 6.5 Ownership modes
- **`managed-block` (default)**: only content between
  `<!-- ctx-lint:begin -->` … `<!-- ctx-lint:end -->` is replaced. If the file exists without markers, sync **refuses** and prints instructions (run `ctx-lint init --import`, or add markers, or use `--force`). If the file doesn't exist, it's created with the markers.
- **`file`**: ctx-lint owns the whole file. It overwrites only if the file is missing or has a ctx-lint header; otherwise it refuses without `--force`.
- Per-rule files (`.mdc`, `.instructions.md`) are always `file` mode.

### 6.6 Write planning
1. Compile every target → `OutputFile[]` (path + content).
2. Compare against disk → actions: `create`, `update`, `unchanged`, `delete` (an orphan: a file with a ctx-lint header in a target output dir that no source rule produces any more).
3. Then, depending on flags:
   - default: apply, then print a summary (`✔ 3 created, 2 updated, 1 deleted, 5 unchanged`)
   - `--dry-run`: print the plan + unified diffs, write nothing
   - `--check`: write nothing, exit 1 if any action ≠ `unchanged` (CI drift guard)
   - `--target <id>` (repeatable): limit to some targets
4. Writes are atomic (temp file + rename). Line endings are LF, and files end with a trailing newline.

### 6.7 `ctx-lint init`
- `init`: creates `.context/config.json` (with `$schema`) and `.context/rules/general.md` as a sample, and turns on the targets whose files it detects in the repo.
- `init --import`: parses existing `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc` / Copilot files into source rules. `.mdc` frontmatter maps back directly. A monolithic markdown file becomes one rule (`imported-claude.md`), or one rule per H2 with `--split`. Exact duplicates across files are merged into one. It prints a summary and a reminder to review before the first `sync`.

---

## 7. `ctx-lint audit` — Detailed Design

### 7.1 Tokenizer
- `heuristic` (default, zero deps): count word pieces, numbers, punctuation and whitespace runs with a regex, then apply calibrated weights: roughly 1 token per short word, `ceil(len/4)` for long words and identifiers, 1 per punctuation char, and code blocks weighted higher. **Calibrate it in Phase 5** against `gpt-tokenizer` o200k on a corpus of 30+ real rule files, aim for ±10%, and document the error.
- `o200k` / `cl100k`: lazy-load `gpt-tokenizer` (an optional dependency). If it's missing, print a clear message telling the user to install it.
- Always labelled "≈ estimated tokens". Docs explain that Claude's tokenizer differs, typically by single-digit to low double-digit percentages.

### 7.2 Always-on baseline per agent
For each agent, sum the tokens of what it loads **on every request**:
- Claude: root `CLAUDE.md` (+ `.claude/CLAUDE.md`) plus files it pulls in with `@path` imports (resolve them one level deep; mark them as imports)
- AGENTS.md agents: root `AGENTS.md`
- Cursor: `.cursor/rules/*.mdc` with `alwaysApply: true` + `.cursorrules`
- Copilot: `.github/copilot-instructions.md`
- Windsurf: `trigger: always_on` rules
Scoped and on-demand content is reported separately as **conditional** tokens.

If `.context/rules` exists, also compute a **projected** baseline from the IR (what `sync` would produce), so users can see the budget impact before syncing.

### 7.3 Report
```
Agent      Always-on   Conditional   Budget   Status
claude        3,412          1,180    3,000   ✖ over by 412
cursor        1,950          2,640    2,500   ✔
copilot       2,210              —    2,500   ✔

Largest always-on sections
  CLAUDE.md  "## Testing conventions"   1,104 tokens
  CLAUDE.md  "## Architecture"            870 tokens

Duplicated content (same paragraph in multiple always-on files): 3 blocks, ≈ 640 tokens
```
Flags: `--budget <n>`, `--tokenizer <name>`, `--format table|json`, `--per-section`. Exits 1 if any agent is over budget (or `--warn-only`).

---

## 8. Quality, Testing & Performance

### 8.1 Test strategy
| Layer | What | How |
|---|---|---|
| Unit | classifier (largest suite: table-driven, 200+ cases of real-world strings → expected kind/confidence), shell tokenizer, Makefile parser, npm workspace resolution, each rule, each target compiler, tokenizer | vitest, pure functions, in-memory `FileIndex` |
| Fixture | Full `check` / `sync` / `audit` runs over `test/fixtures/*` mini-repos | Snapshot the diagnostics JSON and generated files |
| False-positive guard | `fixtures/false-positives/` must produce **zero** diagnostics. Every false-positive bug report adds a case here first. | Required green in CI |
| E2E | Built CLI run via `execa`: exit codes, `--format` outputs, `--fix`, `sync --check` | Runs against `dist/` |
| Cross-platform | CI matrix: ubuntu / macos / windows × Node 22 / 24 / 26 | Catches path separator and case bugs |
| Dogfooding | The repo's own `CLAUDE.md` / `AGENTS.md` are generated by `ctx-lint sync` and linted by `ctx-lint check` in CI | — |

Coverage target: ≥ 90% lines on `parsers/`, `linter/`, `syncer/`; ≥ 80% overall.

### 8.2 Real-world corpus (stretch, Phase 6)
Collect ~50 public `CLAUDE.md` / `AGENTS.md` / `.mdc` files from popular OSS repos into `test/corpus/` (with license notes, or only as URLs plus a fetch script). Run `check` against each repo checkout in a nightly job and track false-positive rate as a metric.

### 8.3 Performance
- One filesystem walk, no per-reference `stat` calls (except lazy `node_modules` checks).
- Parse files concurrently (`Promise.all` with a small limit).
- Benchmark fixture: a synthetic monorepo with 50k files and 20 instruction files, target < 2 s. Benchmarked in CI with `vitest bench` (tracked, not gating).

### 8.4 Code standards
- `strict` TS. No `any` in `src/` (Biome rule). Result-style errors at module boundaries, and only `CtxLintError` subclasses are thrown to the CLI.
- Internally, every path is POSIX + repo-relative. Convert at the edges only.
- Every rule has a docs page in `docs/rules/` and a test file. A CI script checks that the rule registry, the docs and the tests stay in sync.

---

## 9. Demo / Deliverable Example (`examples/demo/`)

A tiny repo that shows all three commands:

```
examples/demo/
├── package.json            # scripts: build, test, lint  · deps: express  · devDeps: vitest
├── pnpm-lock.yaml          # makes package-manager-mismatch fire
├── Makefile                # targets: build, clean
├── src/
│   ├── auth/guard.ts       # note: "guard", not "guards/" → triggers suggestion
│   └── server.ts
├── .context/
│   ├── config.json
│   └── rules/
│       ├── general.md      # alwaysApply
│       ├── api.md          # globs: src/api/**  (which doesn't exist → glob-matches warning)
│       └── testing.md      # on-demand
└── CLAUDE.md               # hand-written, with intentional rot:
    #   `src/auth/guards/`        → path-exists (did you mean src/auth/guard.ts?)
    #   `./scripts/deploy.sh`     → path-exists
    #   `npm run test:e2e`        → script-exists + package-manager-mismatch
    #   `make migrate`            → make-target-exists
    #   "Use `zod` for validation" → dependency-installed
    #   `https://example.com/a/b` → ignored (URL)
    #   `path/to/file`, `<id>`    → ignored (placeholders)
    #   `application/json`        → ignored (MIME)
```
`examples/demo/README.md` shows the exact expected output of `ctx-lint check`. An E2E test asserts the output matches, so the demo can't silently rot.

---

## 10. Open-Source Readiness

- **License**: MIT.
- **README**: one-line pitch, an animated terminal GIF (vhs), quick start (`npx ctx-lint check`), the three commands, a supported-agents table, CI snippets, an FAQ ("Why not an LLM?", "How accurate is the token count?").
- **CONTRIBUTING.md**: setup, architecture overview (link to this plan's §3), and step-by-step guides for *"Adding a rule"*, *"Adding a target"* and *"Adding a manifest provider"*. Each is ≤ 3 files touched.
- **Issue templates**: bug, **false positive** (asks for the exact snippet; this is our #1 quality signal), new target request.
- **Versioning**: SemVer. The JSON output format and config schema are public API; breaking changes need a major bump. Changesets produce the CHANGELOG.
- **Security**: `SECURITY.md`. npm publish with provenance. No install scripts. Dependabot/Renovate on.
- **CI integrations shipped in-repo**:
  - `action.yml` → `uses: <org>/ctx-lint@v1` with inputs `command`, `args`, `format` (defaults to `github` annotations)
  - `.pre-commit-hooks.yaml` → `ctx-lint-check`, `ctx-lint-sync-check`
  - Docs snippets for Husky/lefthook and GitLab CI

---

## 11. Phased Roadmap

Each phase is a mergeable PR (or a small set of them) that keeps `main` green.

### Phase 0 — Repo bootstrap
- [x] `git init` **inside `ctx-lint/`** (the current enclosing git repo is the home directory, so this project needs its own repo)
- [x] pnpm + TypeScript + tsup + vitest + biome configured; `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` all pass
- [x] `src/cli/index.ts` with commander: `--version`, `--help`, stub subcommands
- [x] CI workflow (matrix from §8.1), MIT LICENSE, README stub, CONTRIBUTING stub, `.editorconfig`, `.gitignore`
- **Done when:** `node dist/cli.js --help` lists `check`, `sync`, `audit`, `init`, and CI is green on all 3 OSes.
- **Status (2026-10-17):** done locally. Lint, typecheck, build, unit and e2e tests all pass on macOS / Node 22. CI hasn't run yet (no remote).

### Phase 1 — Core foundations
- [x] `core/` types, errors, logger (`--debug`)
- [x] `config/`: zod schema, loader, defaults, JSON Schema generation script → `schema/config.schema.json`
- [x] `fs/FileIndex`: walk, gitignore, case-exact lookup, glob match, basename map
- [x] `parsers/markdown` + `frontmatter` + `disable-comments`
- [x] `targets/` adapters with `detect` + `isAlwaysOn` only (no compile yet); `discovery/`
- **Done when:** a debug command (`ctx-lint check --debug --list-files`) prints the discovered instruction files and their agents for a fixture repo, and the unit tests pass.
- **Status (2026-10-17):** done. `check --list-files` (stylish + `--format json`) works, and `pnpm verify` passes (43 unit + 2 e2e tests). Notes:
  - Source rules (`.context/rules/**/*.md`) are discovered as kind `source`, and `check.include` files as `extra`.
  - Claude's `.claude/rules/` directory isn't detected yet (see Open Question 1).
  - Running `check` in *this* repo picks up `test/fixtures/**`, so add `check.exclude` when dogfooding (Phase 6).

### Phase 2 — Extraction & classification
- [ ] `extract.ts` for inline code, fenced code (per line, with prompt stripping), links
- [ ] `shell.ts` mini tokenizer (env prefixes, `&&`, `||`, `;`, `|`, quotes, `\` continuations)
- [ ] `classify/` ignore patterns → command → path → package, with confidence
- [ ] Table-driven classifier test suite (≥ 200 cases), plus the `false-positives` fixture
- **Done when:** the classifier suite passes and `--debug --dump-refs` prints typed references with ranges for the demo `CLAUDE.md`.

### Phase 3 — `check` end-to-end
- [ ] `manifests/npm` (root + workspaces from `package.json` `workspaces` or `pnpm-workspace.yaml`; lockfile → package manager), `manifests/make` (targets, `include` one level, ignores `.PHONY`/special/pattern targets), `manifests/just`
- [ ] Rule engine with severity config, inline disables, `unused-disable`
- [ ] All rules in §5.4 except `generated-file-modified` (that comes in Phase 4)
- [ ] Suggestions (basename + Levenshtein), `--fix`
- [ ] Reporters: stylish, json, compact, github, sarif
- [ ] Exit codes, `--max-warnings`, `--quiet`, `--rule`
- [ ] `examples/demo/` + E2E snapshot of its output
- **Done when:** `ctx-lint check` in `examples/demo` prints exactly the expected report from §9 and exits 1. `false-positives` gives 0 diagnostics. The SARIF output validates against the SARIF 2.1.0 schema.

### Phase 4 — `sync`
- [ ] Source loader + frontmatter validation (zod) → `RuleIR[]`
- [ ] Compilers: cursor, claude, agents, copilot (windsurf behind `enabled: false` default)
- [ ] Header + hash, managed-block mode, file mode, orphan deletion
- [ ] Write planner: default / `--dry-run` (diffs) / `--check` / `--target`
- [ ] `generated-file-modified` rule in `check`
- [ ] `init` and `init --import` (with `--split`)
- [ ] Verify every target format against current vendor docs → `docs/targets.md`
- **Done when:** the snapshot tests for every target × rule kind pass, running `sync` twice is idempotent (the second run reports 0 changes), `sync --check` exits 1 after a manual edit, and the import → sync round-trip of the fixture is stable.

### Phase 5 — `audit`
- [ ] Heuristic tokenizer + calibration script (`scripts/calibrate-tokenizer.ts`), with the error documented
- [ ] Optional `gpt-tokenizer` integration
- [ ] Baseline per agent (incl. Claude `@imports`), conditional tokens, projected baseline from the IR
- [ ] Section breakdown, duplicate detection, budget exit code
- **Done when:** the audit fixture's numbers are within the documented tolerance of o200k, and a budget overrun exits 1.

### Phase 6 — Hardening & polish
- [ ] Git rename detection for suggestions
- [ ] tsconfig `paths` alias resolution
- [ ] Real-world corpus run, then fix the top false positives
- [ ] Performance benchmark on the synthetic 50k-file repo
- [ ] `ctx-lint explain <rule>` (prints the rule docs in the terminal)
- [ ] Dogfood: this repo's `CLAUDE.md` / `AGENTS.md` come from `.context/rules`
- **Done when:** the false-positive rate on the corpus is < 2% of reported diagnostics (manually triaged), and the benchmark is under target.

### Phase 7 — Release v0.1.0
- [ ] Check the npm name; set `package.json` metadata (`bin`, `exports`, `files`, `engines`, `keywords`, `repository`)
- [ ] `action.yml`, `.pre-commit-hooks.yaml`, docs for CI
- [ ] README with GIF, full docs pages
- [ ] Changesets release workflow with npm provenance
- [ ] (Optional) `bun build --compile` binaries for macOS/Linux/Windows attached to GitHub Releases, plus a Homebrew tap
- **Done when:** `npx ctx-lint@latest check` works in a fresh repo, and the GitHub Action annotates a PR in a sample repo.

### Later (post-v1 backlog)
- More ecosystems: `pyproject.toml` (uv/poetry scripts, deps), `Cargo.toml`, `go.mod`, `Taskfile.yml`, `composer.json`
- `turbo`/`nx` task verification
- Watch mode (`sync --watch`)
- VS Code extension using the programmatic API (inline diagnostics in `CLAUDE.md`)
- More targets: Gemini CLI (`GEMINI.md`), Zed, Cline (`.clinerules`), Junie
- Env var rule: `` `DATABASE_URL` `` documented in `.env.example`
- Plugin loading (`plugins: ["ctx-lint-plugin-foo"]`) once the internal interfaces are stable

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| False positives in path/package detection | Users uninstall the tool | Confidence tiers, `minConfidence`, a large table-driven suite, a false-positive fixture gate, a dedicated issue template, warnings (not errors) for medium confidence |
| Vendor formats change (Cursor/Copilot/Windsurf frontmatter) | `sync` output silently stops working | Format details isolated per adapter, doc links + "verified on" dates in `docs/targets.md`, snapshot tests |
| Overwriting a user's hand-written `CLAUDE.md` | Lost work, no trust | Managed-block default, refuse without markers, `--dry-run`, `init --import` |
| Token estimates mistaken for exact numbers | Misleading budget decisions | Always labelled "≈", calibrated and documented error, optional exact tokenizer |
| Windows path/case issues | Broken on a third of dev machines | POSIX internally, Windows in the CI matrix, `path-case` rule |
| Monorepo script resolution (which `package.json`?) | Wrong pass/fail | Resolve the nearest `package.json` to the instruction file, plus explicit `--filter`/`-w` handling, plus "exists in some workspace" downgraded to a warning with a hint |

---

## 13. Decision Log

| # | Decision | Rationale | Date |
|---|---|---|---|
| 1 | TypeScript / Node ≥ 22.12, ESM-only | Users' ecosystem, `npx` distribution, mdast tooling, contributors (§2.1) | 2026-10-17 |
| 2 | `picocolors` instead of `chalk` | Same capability, much smaller, no deps | 2026-10-17 |
| 3 | Biome instead of ESLint + Prettier | One fast tool, less config | 2026-10-17 |
| 4 | Heuristic tokenizer by default, exact one optional | Keeps install light and offline; exact Claude tokenizer isn't available offline anyway | 2026-10-17 |
| 5 | `managed-block` is the default sync mode | Non-destructive adoption in repos that already have hand-written files | 2026-10-17 |
| 6 | Confidence-tiered classification | Precision over recall (§1.3) | 2026-10-17 |
| 7 | Single config at `.context/config.json` covering sync, check and audit | Matches the original idea; one file for users to learn | 2026-10-17 |
| 8 | Minimum Node raised from 20 to 22.12 | Node 20 reached end-of-life in April 2026; commander 15, tsup 9 and vitest 5 all require Node ≥ 22.12 | 2026-10-17 |
| 9 | Pin TypeScript to 6.x | TS 7 ships no compiler API; tsup 9 + rollup-plugin-dts break on it. Revisit when tsup supports TS 7 | 2026-10-17 |
| 10 | `FileIndex` uses opaque directories + lazy, case-exact lookups instead of indexing `node_modules` etc. | Fast walks on big repos while references into heavy dirs still resolve exactly (§5.1) | 2026-10-17 |
| 11 | Config is JSONC; `pnpm ci` renamed to `pnpm verify` | The plan's own config examples use comments; `pnpm ci` is a reserved pnpm command | 2026-10-17 |

## 14. Open Questions (resolve before or during the phase noted)
1. **Phase 4:** Should Claude scoped rules default to `sections` or `nested` CLAUDE.md files? Leaning `sections`, which is more predictable and keeps everything in one file. Check whether Claude Code's current path-scoped rule support (e.g. a `.claude/rules/` directory with path frontmatter) is stable enough to be a third mode.
2. **Phase 3:** Should a script that exists in *some* workspace but not the nearest one be an error or a warning? Proposed: a warning with a hint.
3. **Phase 7:** Final npm package name and GitHub org.
4. **Phase 2:** Should `check` lint paths in fenced code blocks of non-shell languages (e.g. `import x from './foo'` in a TS example)? Proposed: no in v1, since that's generic example code.
