# `ctx-lint check`

Lints agent instruction files: every file path, glob, link, script, Make target, executable and
library they mention is checked against the repository. Everything runs offline, from the files
on disk.

```bash
ctx-lint check                 # every instruction file in the repo
ctx-lint check CLAUDE.md docs/ # only these
```

## Which files are checked

| Agent | Files |
|---|---|
| Claude Code | `**/CLAUDE.md`, `**/CLAUDE.local.md`, `.claude/rules/**/*.md` |
| AGENTS.md (Codex, opencode, Amp, …) | `**/AGENTS.md` |
| Cursor | `**/.cursor/rules/**/*.mdc`, `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` |
| Windsurf / Devin | `**/.windsurf/rules/**/*.md`, `**/.devin/rules/**/*.md`, `.windsurfrules` |
| `ctx-lint sync` sources | `.context/rules/**/*.md` (the `sources` option) |

Add more with `check.include` and skip some with `check.exclude` ([configuration](configuration.md)).
`ctx-lint check --list-files` prints what would be linted.

Not walked: `.git`, `node_modules`, package-manager stores, tool caches (`.next`, `.venv`,
`__pycache__`, …) and anything gitignored. References into them are still resolved. A file that
is a symlink to another checked file (`CLAUDE.md` → `AGENTS.md`) is linted once, on its target.

## What is checked

| Written in the file | Rule | Default |
|---|---|---|
| `` `src/auth/guard.ts` ``, `[guide](docs/guide.md)` | [path-exists](rules/path-exists.md) | error |
| `` `src/Auth/guard.ts` `` when the file is `src/auth/guard.ts` | [path-case](rules/path-case.md) | error |
| `` `src/**/*.test.ts` ``, `globs:` / `applyTo:` / `paths:` frontmatter | [glob-matches](rules/glob-matches.md) | warn |
| `[setup](docs/guide.md#install)` | [link-anchor](rules/link-anchor.md) | warn |
| `pnpm test:e2e`, `npm run build`, `node --run lint` | [script-exists](rules/script-exists.md) | error |
| `make migrate`, `just deploy` | [make-target-exists](rules/make-target-exists.md) | error |
| `npx vitest`, `pnpm exec tsc` | [bin-exists](rules/bin-exists.md) | warn |
| `npm run x` in a pnpm repo | [package-manager-mismatch](rules/package-manager-mismatch.md) | warn |
| "Use `zod` for validation", `import { z } from 'zod'` | [dependency-installed](rules/dependency-installed.md) | warn |
| Invalid or misspelled frontmatter (`globs` in a Copilot file) | [frontmatter-valid](rules/frontmatter-valid.md) | error |
| A hand edit inside generated content | [generated-file-modified](rules/generated-file-modified.md) | warn |
| A disable comment that suppresses nothing | [unused-disable](rules/unused-disable.md) | warn |

References are found in inline code, fenced shell blocks (one command per logical line, with `\`
continuations joined), markdown links and images, import statements in code blocks, and rule
frontmatter. Plain prose without backticks is never treated as a reference.

### How paths are resolved

- **Markdown links** resolve against the file they're in, as on GitHub. So do paths starting
  with `../`.
- **Everything else** (`src/x.ts`, and `./x` in prose or commands) is tried at the repo root,
  then in the file's directory and each directory between. Nested instruction files often write
  paths relative to their package.
- `@/components/Button` and other tsconfig/jsconfig `paths` aliases are expanded. Extensionless
  module paths try `.ts`, `.tsx`, `index.ts` and so on, and `x.js` also finds `x.ts`.
- A path that's missing but gitignored (`.env.local`, `out/`) is not reported, and neither is
  one matching `check.ignorePaths` (`dist/**`, `build/**`, `coverage/**`, `node_modules/**`,
  `.env*` by default).
- `cd packages/web && pnpm build` checks `build` in `packages/web`. So does a command below a
  `# from the repo root` comment in a code block, which runs at the root.

### Suggestions and `--fix`

Every missing path comes with the likeliest fix, in this order:

1. **Git history:** "It was renamed to `src/security/guard.ts` in a1b2c3d." `ctx-lint` reads
   renames from the last 1,000 commits of your local `git log`. It doesn't fetch, and it does
   nothing outside a git repository.
2. **The same file name elsewhere:** "Did you mean `packages/ui/src/Header.tsx`?" (it moved).
3. **A near-miss name** in the directory where it should be (it was renamed or misspelled).

`ctx-lint check --fix` applies a suggestion only when it's unambiguous: a recorded rename, a
single moved file, or a case difference. It keeps your style (`./`, trailing `/`) and never edits
generated content. Everything else is left for you to decide.

## Confidence

Backticks are used for code, flags, identifiers and placeholders as well as paths, so not every
backticked word is a reference. Each candidate gets a confidence:

| Confidence | Example | Reported as |
|---|---|---|
| high | `` `src/auth/guard.ts` ``, a markdown link, `pnpm test:e2e` | the rule's severity (often error) |
| medium | `` `src/auth` ``, a path in a shell command, "Use `zod`" | at most a **warning** |
| low | a bare `` `README.md` ``, `` `*.js.map` ``, "files such as `x`" | skipped by default |

Only references `ctx-lint` is sure about can fail CI. Change the threshold with
`check.minConfidence`. To see what was found and how sure it was, run:

```bash
ctx-lint check --dump-refs CLAUDE.md          # every reference, with its confidence
ctx-lint check --dump-refs --debug CLAUDE.md  # also what was ignored, and why
```

These are never references: URLs, emails, versions, placeholders (`<id>`, `{name}`,
`path/to/file`, `your-app/`, `skill-name/`), routes (`/users/:id`, `/settings`), CLI flags, Git
refs, MIME types and similar. See [accuracy.md](accuracy.md) for the full approach.

## Handling false positives

When a report is wrong, pick the narrowest fix:

1. **One line:** add a disable comment, with a reason after `--`:

   ```md
   <!-- ctx-lint-disable-next-line path-exists -- created by the build -->
   Output goes to `dist/bundle.js`.

   - The cache lives in `.cache/` <!-- ctx-lint-disable-line -->
   ```

2. **A block:**

   ```md
   <!-- ctx-lint-disable dependency-installed -->
   …
   <!-- ctx-lint-enable -->
   ```

   Without rule ids, every rule is disabled. [unused-disable](rules/unused-disable.md) warns when
   a comment no longer suppresses anything.

3. **A path that's legitimately missing:** add a glob to `check.ignorePaths`.
4. **A pattern that's never a reference in your docs:** add a regex to `check.ignorePatterns`.
5. **A rule that doesn't fit your repo:** `"check": { "rules": { "dependency-installed": "off" } }`,
   or `--rule dependency-installed=off` for one run. `--no-deps` skips the dependency check.

If you think `ctx-lint` itself is wrong, please open an issue with the line. Every false positive
fixed becomes a test case.

## Output formats

`--format` picks the output:

| Format | For |
|---|---|
| `stylish` (default) | People: grouped by file, colored |
| `compact` | Editors and `grep`: one `file:line:col: severity - message (rule)` per line |
| `json` | Scripts: a stable, versioned shape (below) |
| `github` | GitHub Actions: inline PR annotations |
| `sarif` | Code scanning (SARIF 2.1.0), e.g. GitHub's Security tab |

The JSON shape is public API: fields are only added, and a breaking change bumps `version`.
`suggestion.replacement` is present when `--fix` can apply the suggestion.

```json
{
  "version": 1,
  "tool": { "name": "ctx-lint", "version": "0.1.0" },
  "errorCount": 1,
  "warningCount": 0,
  "fixableCount": 0,
  "files": [
    {
      "path": "CLAUDE.md",
      "errorCount": 1,
      "warningCount": 0,
      "fixableCount": 0,
      "messages": [
        {
          "ruleId": "path-exists",
          "severity": "error",
          "message": "Path \"src/auth/guards/\" does not exist. Did you mean \"src/auth/guard.ts\"?",
          "line": 7,
          "column": 24,
          "endLine": 7,
          "endColumn": 40,
          "suggestion": { "message": "Did you mean \"src/auth/guard.ts\"?" }
        }
      ]
    }
  ]
}
```

## Options

| Option | |
|---|---|
| `--format <format>` | `stylish`, `compact`, `json`, `github`, `sarif` |
| `--fix` | Apply unambiguous fixes, then report what's left |
| `--max-warnings <n>` | Exit 1 when there are more than `n` warnings |
| `--quiet` | Report errors only |
| `--rule <id=severity>` | Override a rule for this run: `error`, `warn` or `off` (repeatable) |
| `--no-deps` | Skip `dependency-installed` |
| `--list-files` | Print the files that would be linted, then exit |
| `--dump-refs` | Print every reference found, then exit (`--debug` adds ignored ones) |

Exit codes: `0` no errors, `1` errors (or more warnings than `--max-warnings`), `2` usage or
configuration error. See also the [CLI reference](cli.md).
