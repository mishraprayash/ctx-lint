# How ctx-lint works, and how accurate it is

`ctx-lint` reads instruction files written for people and language models, and decides which
backticked words are references to something in your repo. That's a heuristic, and it's
sometimes wrong. This page explains how it decides, what keeps mistakes from failing your
build, and how often it's wrong on real repositories.

## Offline by design

`ctx-lint` never calls a network service or a language model. Every check is answered from
files on disk:

| Reference | Checked against |
|---|---|
| A path, glob or link | One walk of the repository's file tree |
| `pnpm test:e2e`, `npm run build` | `scripts` in the `package.json` that would run it |
| `make migrate`, `just deploy` | Targets in the `Makefile` / `justfile` (with `include`s) |
| `npx vitest` | `node_modules/.bin` and `bin` entries of workspace packages |
| `@/components/Button` | tsconfig/jsconfig `paths` |
| `docs/guide.md#install` | The headings of that markdown file |
| "Use `zod`" | Dependencies in every `package.json`, plus `pyproject.toml` and `requirements*.txt` |
| "renamed to X in a1b2c3d" | Your local `git log` (no fetch) |

The same input always gives the same output, so it's safe in CI. It's also fast: about 0.3 s on a
synthetic repository of 50,000 files (`pnpm bench`).

## From text to references

1. **Extract.** Candidates come from inline code, fenced shell blocks, markdown links, import
   statements in code blocks, and rule frontmatter (`globs`, `applyTo`, `paths`). Plain prose
   without backticks is never a candidate.
2. **Classify.** Each candidate is a path, a script, a Make target, an executable, a library,
   or nothing. The decision uses its shape and the words around it:
   - `src/auth/guard.ts` has a directory and a known extension.
   - `pnpm test:e2e` is parsed as a shell command.
   - "Use `zod`": `zod` follows an instruction verb.
   - `<id>`, `{name}`, `path/to/x`, `/users/:id` and `tools/report.attr_name` are placeholders,
     routes or identifiers, so they're ignored.
3. **Grade.** Each reference gets a confidence: high, medium or low
   ([check.md](check.md#confidence)).
4. **Check.** The rules check each reference against the repository.

`ctx-lint check --dump-refs --debug <file>` shows the result of steps 1–3 for a file: every
reference, its confidence, and every ignored candidate with the reason.

## What keeps mistakes from failing your build

- **Only high-confidence references can be errors.** A path with a directory and a known
  extension, a markdown link, or a `package.json` script qualifies. Anything less sure is a
  warning at most, and warnings don't fail CI unless you ask (`--max-warnings`).
- **Low confidence is skipped** by default. That covers bare file names (`README.md` could be any
  README), bare globs, examples ("files such as `x`"), hypotheticals ("may use `x`") and lists of
  generated files.
- **Missing but expected** paths aren't reported: gitignored paths, build output
  (`check.ignorePaths`), and folders created at run time that are listed as ignored.
- **Context awareness** catches common cases:
  - `cd dir && cmd` and `# from the root` comments.
  - Paths relative to the file's package.
  - Python dependencies in mixed repos.
  - Workspace packages by their short name.
  - Agent skills (generic advice about libraries).
- **Every false positive gets a test.** The test suite has more than 500 cases, including a fixture
  repository of tricky text that must produce zero diagnostics.

## Measured accuracy

The heuristics were tuned on a corpus of public repositories: sentry, n8n, excalidraw, tldraw,
vscode, pydantic-ai, cal.com, supabase, PostHog and TypeScript. That's 202 instruction files.
Every diagnostic was triaged by hand.

| | Diagnostics | False positives |
|---|---|---|
| Errors | 29 | 3 (10%) |
| Warnings | 28 | 8 (29%) |

The true positives were real context rot:
- Test files that had moved (pydantic-ai, vscode).
- A CLAUDE.md listing paths from a different package (n8n).
- Broken links (vscode).
- Stale paths (cal.com, PostHog).
- Scripts documented in the wrong package (n8n, supabase).

Most remaining false positives can't be decided offline:
- Folders created at run time or by a build.
- A sibling repository outside this one.
- Object-store keys.
- A path relative to another package mentioned in the same sentence.

**A caveat about these numbers.** They were measured on the same repositories the heuristics were
tuned on, which flatters them. As a held-out check, three repositories the heuristics had never
seen (vite, claude-code-action and uv; 4 instruction files, about 74 references) gave 1 diagnostic,
a false-positive warning that has since been fixed. That sample is small, so expect your own
numbers to be somewhat worse than the table above.

Reproduce or extend the measurement with `pnpm corpus` ([CONTRIBUTING.md](../CONTRIBUTING.md)).
`--only owner/repo` runs it on repositories that weren't used for tuning.

## When it's wrong

- Suppress one line or block with a disable comment, a path with `check.ignorePaths`, or a pattern
  with `check.ignorePatterns` ([check.md](check.md#handling-false-positives)).
- Please report it, with the line that was misread. The fix comes with a test, so it stays fixed.

## Known limits

- Only npm scripts, Make and just targets are checked as commands. Cargo, Go, uv and Poetry tasks
  aren't verified yet.
- Library mentions are checked for npm only (Python dependencies count as declared, but nothing
  is reported for Python, Rust or Go libraries).
- Prose without backticks isn't checked: "see the auth guard" can rot without being noticed.
- Token counts from `audit` are estimates (median error 3% against o200k). Claude's tokenizer
  isn't public.
