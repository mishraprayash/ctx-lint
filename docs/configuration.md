# Configuration

`ctx-lint` works with no configuration. To change anything, create `.context/config.json`
(`ctx-lint init` writes one), or pass `--config <path>`. Comments and trailing commas are allowed
(JSONC).

Add the `$schema` line for completion and validation in your editor:

```jsonc
{
  "$schema": "https://unpkg.com/ctx-lint/schema/config.schema.json",
  "targets": {
    "cursor": { "enabled": false }
  },
  "check": {
    "ignorePaths": ["dist/**", "generated/**"],
    "rules": { "dependency-installed": "off" }
  },
  "audit": {
    "budget": { "default": 2000, "claude": 3000 }
  }
}
```

Unknown keys are errors, so a typo doesn't silently do nothing. An invalid config exits with code
2 and says which key is wrong. The schema ships in the package as `schema/config.schema.json`.

## Top level

| Key | Default | |
|---|---|---|
| `sources` | `".context/rules"` | Directory of source rules for `sync` |
| `mode` | `"managed-block"` | `managed-block`: in `CLAUDE.md`, `AGENTS.md` and `copilot-instructions.md`, only the content between ctx-lint markers is generated. `file`: those files are generated whole. |
| `targets` | see below | Which agents `sync` generates files for |
| `check` | see below | `ctx-lint check` |
| `audit` | see below | `ctx-lint audit` |

## `targets`

Every target has `enabled` (whether `sync` writes it). Windsurf is off by default; the rest are on.

| Target | Keys | Defaults |
|---|---|---|
| `claude` | `output`, `scopedRules` | `"CLAUDE.md"`, `"rules"` |
| `agents` | `output`, `scopedRules` | `"AGENTS.md"`, `"sections"` |
| `cursor` | `outputDir` | `".cursor/rules"` |
| `copilot` | `output`, `scopedRules` | `".github/copilot-instructions.md"`, `"instructions"` |
| `windsurf` | `outputDir` | `".windsurf/rules"` (`enabled: false`) |

`scopedRules` decides where path-scoped rules go:

- **`claude`:**
  - `"rules"`: `.claude/rules/<id>.md` with `paths`, loaded only for matching files.
  - `"sections"`: sections of `CLAUDE.md`.
  - `"nested"`: a `CLAUDE.md` in the glob's directory.
- **`agents`:**
  - `"sections"`: sections of `AGENTS.md`.
  - `"nested"`: an `AGENTS.md` in the glob's directory.
- **`copilot`:**
  - `"instructions"`: `.github/instructions/<id>.instructions.md` with `applyTo`.
  - `"sections"`: sections of the main file.

The enabled targets also tell `audit` which agents you use.

## `check`

| Key | Default | |
|---|---|---|
| `include` | `[]` | Extra files to lint (globs), e.g. `["docs/ai/**/*.md"]` |
| `exclude` | `[]` | Files not to lint (globs), e.g. `["test/fixtures/**"]` |
| `rules` | `{}` | Severity per rule: `"error"`, `"warn"` or `"off"` |
| `ignorePaths` | `["dist/**", "build/**", "coverage/**", "node_modules/**", ".env*"]` | Referenced paths that may legitimately be missing. Replaces the default list, so keep the entries you still want. |
| `ignorePatterns` | `[]` | Regular expressions. A reference whose text matches is skipped, e.g. `"^generated/"` |
| `aliases` | `{}` | Path aliases used in your docs, on top of tsconfig `paths`: `{ "@/": "src/" }` |
| `minConfidence` | `"medium"` | Skip references below this confidence: `"high"`, `"medium"` or `"low"`. See [check.md](check.md#confidence). |

tsconfig/jsconfig `paths` at the repo root (and their local `extends`) are read automatically.
`check.aliases` is for aliases that aren't there, or for repos without a tsconfig.

`--rule <id>=<severity>` on the command line overrides `check.rules` for one run. Medium-confidence
references are reported as warnings at most, whatever the rule's severity.

## `audit`

| Key | Default | |
|---|---|---|
| `tokenizer` | `"heuristic"` | `heuristic` (no dependencies), `o200k` or `cl100k` (need the optional `gpt-tokenizer` package) |
| `budget.default` | `2500` | Always-on token budget for every agent |
| `budget.<agent>` | — | Per-agent budget: `claude`, `agents`, `cursor`, `copilot`, `windsurf` |
| `fileWarn` | `1500` | Warn when a single file is larger than this |

`--budget <n>` and `--tokenizer <name>` override these for one run. See [audit.md](audit.md).

## Programmatic use

The same schema is exported as `configSchema`, with `loadConfig()` and `parseConfig()` helpers.
See [api.md](api.md).
