# Programmatic API

Everything the CLI does is available from the `ctx-lint` package, for editor integrations,
custom CI steps or scripts. It's ESM only and needs Node.js 22.12 or newer.

```ts
import { audit, check, createContext, sync } from 'ctx-lint';

const ctx = await createContext({ root: process.cwd() });

const result = await check(ctx);
for (const file of result.files) {
  for (const d of file.diagnostics) {
    console.log(`${file.path}:${d.range.start.line} ${d.severity} ${d.message} (${d.ruleId})`);
  }
}
process.exitCode = result.errorCount > 0 ? 1 : 0;
```

## The project context

`createContext(options)` loads the configuration and indexes the repository once. Pass the same
context to several commands.

| Option | |
|---|---|
| `root` | Repository root. Default: the nearest directory above `process.cwd()` that contains `.git` (`findProjectRoot`) |
| `configPath` | Path to a config file. Default: `<root>/.context/config.json` if it exists |
| `logger` | A `Logger` for debug output (`createLogger`). Default: silent |

## Commands

| Function | Returns | Same as |
|---|---|---|
| `check(ctx, { files?, cwd?, fix?, rules?, quiet?, deps? })` | `CheckResult`: `files`, `errorCount`, `warningCount`, `fixableCount`, `fixed` | `ctx-lint check` |
| `sync(ctx, { dryRun?, targets?, force? })` | `SyncResult`: `plan` (changes, conflicts, problems), `written`, `outOfDate` | `ctx-lint sync` (`dryRun` is also what `--check` uses) |
| `audit(ctx, { budget?, tokenizer? })` | `AuditResult`: `agents` (always-on, conditional, budget, duplicates), `projected`, `sections`, `largeFiles`, `overBudget` | `ctx-lint audit` |
| `init(ctx, { import?, split? })` | `InitResult`: `created`, `configExisted`, `enabledTargets`, `imported` | `ctx-lint init` |

The option types (`CheckOptions`, `SyncOptions`, `AuditOptions`, `InitOptions`) are exported.

Each diagnostic has `ruleId`, `severity` (`'error'` or `'warn'`), `message`, `range` (1-based
`line` / `column` and a 0-based `offset` for `start` and `end`), and an optional `suggestion`
(`{ message, replacement? }`).

## Formatting results

```ts
import pc from 'picocolors';
import { REPORTERS, VERSION } from 'ctx-lint';

const colors = pc.createColors(false);
process.stdout.write(REPORTERS.sarif(result, { root: ctx.root, colors, version: VERSION }));
```

A `Reporter` is a pure function `(result, { root, colors, version }) => string`.

`REPORTERS` holds `stylish`, `compact`, `json`, `github` and `sarif`. The JSON format's version is
exported as `JSON_FORMAT_VERSION`.

## Lower-level building blocks

Use these to build your own checks on the same parsing:

| Export | |
|---|---|
| `discover(ctx, options?)` | The instruction files, read and parsed (`LoadedFile[]`) |
| `extractCandidates(input)` | Candidate references in one parsed file |
| `classify(candidate, classifyContext)` | What a candidate references, with its confidence |
| `referencesOf(ctx, file)` | Every classified reference in a file |
| `lintFiles(ctx, files, options?)` | Run the rules over loaded files |
| `RULES`, `getRule(id)` | The rule registry (`LintRule`: `id`, `meta`, `reference()` / `file()`) |
| `TARGETS`, `getTarget(id)` | The agent format adapters used by `sync` |
| `loadSources(ctx)`, `planSync(ctx, { targets?, force? })` | Source rules → `RuleIR[]` → the planned writes |
| `estimateTokens(text)`, `loadTokenizer(name)` | The token estimators used by `audit` |
| `FileIndex` | The repository file index (case-exact lookups, glob matching) |
| `configSchema`, `loadConfig()`, `parseConfig()`, `defaultConfig()` | Configuration |

## Errors

Expected failures throw a subclass of `CtxLintError` with an `exitCode`: `ConfigError` for an
invalid configuration, `UsageError` for invalid arguments. `ExitCode` holds the codes the CLI
uses: `Success` (0), `Failure` (1) and `Fatal` (2).

## Stability

The package is pre-1.0. The command functions, their results and the JSON report format are
intended to stay compatible; the lower-level building blocks may still change between minor
versions.
