import { z } from 'zod';

// The config schema is the single source of truth for validation, defaults and the published
// JSON Schema (schema/config.schema.json, regenerated with `pnpm schema`). See PLAN.md §4.
//
// `prefault({})` (rather than `default({})`) makes zod parse the empty object, so nested
// defaults are filled in when a whole section is missing.

const severity = z.enum(['error', 'warn', 'off']);

const markdownTarget = (output: string) =>
  z.strictObject({
    enabled: z.boolean().default(true).describe('Generate this target during `ctx-lint sync`.'),
    output: z.string().min(1).default(output).describe('Output file, relative to the repo root.'),
    scopedRules: z
      .enum(['sections', 'nested'])
      .default('sections')
      .describe(
        'How path-scoped rules are emitted: as sections of the root file, or as nested files in the matching directories.',
      ),
  });

const dirTarget = (outputDir: string, enabled: boolean) =>
  z.strictObject({
    enabled: z.boolean().default(enabled).describe('Generate this target during `ctx-lint sync`.'),
    outputDir: z
      .string()
      .min(1)
      .default(outputDir)
      .describe('Directory for generated rule files, relative to the repo root.'),
  });

const copilotTarget = z.strictObject({
  enabled: z.boolean().default(true).describe('Generate this target during `ctx-lint sync`.'),
  output: z
    .string()
    .min(1)
    .default('.github/copilot-instructions.md')
    .describe('Output file, relative to the repo root.'),
  scopedRules: z
    .enum(['instructions', 'sections'])
    .default('instructions')
    .describe(
      'How path-scoped rules are emitted: as `.github/instructions/*.instructions.md` files, or as sections of the main file.',
    ),
});

const regex = z.string().refine(
  (value) => {
    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'must be a valid regular expression' },
);

const tokenCount = z.number().int().positive();

export const configSchema = z
  .strictObject({
    $schema: z.string().optional(),

    sources: z
      .string()
      .min(1)
      .default('.context/rules')
      .describe('Directory of source rule files used by `ctx-lint sync`.'),
    mode: z
      .enum(['managed-block', 'file'])
      .default('managed-block')
      .describe(
        '`managed-block`: only replace content between ctx-lint markers. `file`: own the whole generated file.',
      ),

    targets: z
      .strictObject({
        claude: markdownTarget('CLAUDE.md').prefault({}),
        agents: markdownTarget('AGENTS.md').prefault({}),
        cursor: dirTarget('.cursor/rules', true).prefault({}),
        copilot: copilotTarget.prefault({}),
        windsurf: dirTarget('.windsurf/rules', false).prefault({}),
      })
      .prefault({}),

    check: z
      .strictObject({
        include: z
          .array(z.string())
          .default([])
          .describe('Extra files to lint (globs, relative to the repo root).'),
        exclude: z.array(z.string()).default([]).describe('Files to skip (globs).'),
        rules: z
          .record(z.string(), severity)
          .default({})
          .describe('Rule severity overrides, e.g. { "dependency-installed": "off" }.'),
        ignorePaths: z
          .array(z.string())
          .default(['dist/**', 'build/**', 'coverage/**', '.env*'])
          .describe('Referenced paths that may legitimately be missing (globs).'),
        ignorePatterns: z
          .array(regex)
          .default([])
          .describe('Regular expressions for references to skip entirely.'),
        aliases: z
          .record(z.string(), z.string())
          .default({})
          .describe('Import aliases used in docs, e.g. { "@/": "src/" }.'),
        minConfidence: z
          .enum(['high', 'medium', 'low'])
          .default('medium')
          .describe('References classified below this confidence are skipped.'),
      })
      .prefault({}),

    audit: z
      .strictObject({
        tokenizer: z.enum(['heuristic', 'o200k', 'cl100k']).default('heuristic'),
        budget: z
          .strictObject({
            default: tokenCount.default(2500),
            claude: tokenCount.optional(),
            agents: tokenCount.optional(),
            cursor: tokenCount.optional(),
            copilot: tokenCount.optional(),
            windsurf: tokenCount.optional(),
          })
          .prefault({})
          .describe('Always-on token budget, with optional per-agent overrides.'),
        fileWarn: tokenCount
          .default(1500)
          .describe('Warn when a single file is larger than this many tokens.'),
      })
      .prefault({}),
  })
  .describe('ctx-lint configuration (.context/config.json)');

/** Config as written by the user (everything optional). */
export type ConfigInput = z.input<typeof configSchema>;
/** Config after defaults are applied. */
export type Config = z.output<typeof configSchema>;
