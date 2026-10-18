import { Command, Option } from 'commander';
import { check } from '../../api/check.js';
import { UsageError } from '../../core/errors.js';
import { ExitCode } from '../../core/exit-codes.js';
import type { Severity } from '../../core/types.js';
import { VERSION } from '../../core/version.js';
import { discover } from '../../discovery/index.js';
import { getRule } from '../../linter/rules/index.js';
import { referencesOf } from '../../parsers/references.js';
import { FORMATS, type Format, REPORTERS } from '../../reporters/index.js';
import { fileListJson, formatFileList, formatReferences, referencesJson } from '../debug-output.js';
import { contextFor, globalOptions, loggerFor } from '../global-options.js';
import type { CommandRuntime } from '../io.js';
import { collect, parseCount } from '../option-parsers.js';

interface CheckOptions {
  format: Format;
  maxWarnings?: number;
  quiet?: boolean;
  fix?: boolean;
  rule: string[];
  deps: boolean;
  listFiles?: boolean;
  dumpRefs?: boolean;
}

export function checkCommand(runtime: CommandRuntime): Command {
  return new Command('check')
    .description('Lint agent instruction files for broken paths, scripts and dependencies')
    .argument('[files...]', 'files to lint (default: auto-discover)')
    .addOption(new Option('--format <format>', 'output format').choices(FORMATS).default('stylish'))
    .option('--max-warnings <n>', 'exit with an error if warnings exceed this number', parseCount)
    .option('--quiet', 'report errors only')
    .option('--fix', 'apply safe fixes')
    .option(
      '--rule <id=severity>',
      'override a rule severity, e.g. path-exists=warn (repeatable)',
      collect,
      [],
    )
    .option('--no-deps', 'skip dependency checks')
    .option('--list-files', 'print the instruction files that would be linted, then exit')
    .option(
      '--dump-refs',
      'print every reference found (with --debug: ignored ones too), then exit',
    )
    .action(async (fileArgs: string[], options: CheckOptions, command: Command) => {
      const globals = globalOptions(command);
      const logger = loggerFor(globals, runtime);
      const ctx = await contextFor(globals, logger);
      // With --cwd, file arguments are relative to that directory, like the rest of the run.
      const cwd = globals.cwd !== undefined ? ctx.root : process.cwd();
      const json = options.format === 'json';

      if (options.listFiles || options.dumpRefs) {
        const files = await discover(ctx, { files: fileArgs, cwd });
        if (options.listFiles) {
          runtime.stdout(
            json
              ? `${JSON.stringify(fileListJson(ctx, files), null, 2)}\n`
              : formatFileList(ctx, files, logger.colors),
          );
        } else {
          const entries = files.map((file) => ({ file, refs: referencesOf(ctx, file) }));
          runtime.stdout(
            json
              ? `${JSON.stringify(referencesJson(entries, logger.debugEnabled), null, 2)}\n`
              : formatReferences(entries, logger.colors, logger.debugEnabled),
          );
        }
        return;
      }

      const result = await check(ctx, {
        files: fileArgs,
        cwd,
        rules: parseRuleOverrides(options.rule),
        deps: options.deps,
        quiet: options.quiet === true,
        fix: options.fix === true,
      });

      runtime.stdout(
        REPORTERS[options.format](result, {
          root: ctx.root,
          colors: logger.colors,
          version: VERSION,
        }),
      );
      if (result.fixed.problems > 0) {
        const { problems, files } = result.fixed;
        runtime.stderr(
          `${logger.colors.green('✔')} Fixed ${problems} problem${problems === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'} (each fix re-checked).\n`,
        );
      }
      if (result.reverted.problems > 0) {
        const { files } = result.reverted;
        runtime.stderr(
          `${logger.colors.yellow('!')} Undid the fixes in ${files} file${files === 1 ? '' : 's'}: re-checking showed they didn't resolve the problem.\n`,
        );
      }

      const tooManyWarnings =
        options.maxWarnings !== undefined && result.warningCount > options.maxWarnings;
      if (tooManyWarnings) {
        runtime.stderr(
          `ctx-lint found too many warnings (maximum: ${options.maxWarnings}, found: ${result.warningCount}).\n`,
        );
      }
      runtime.exitCode =
        result.errorCount > 0 || tooManyWarnings ? ExitCode.Failure : ExitCode.Success;
    });
}

const SEVERITIES = new Set<Severity>(['error', 'warn', 'off']);

function parseRuleOverrides(values: readonly string[]): Record<string, Severity> {
  const overrides: Record<string, Severity> = {};
  for (const value of values) {
    const [id, severity] = value.split('=');
    if (!id || !severity || !SEVERITIES.has(severity as Severity)) {
      throw new UsageError(
        `Invalid --rule "${value}". Use <rule-id>=<error|warn|off>, e.g. --rule path-exists=warn.`,
      );
    }
    if (!getRule(id))
      throw new UsageError(
        `Unknown rule "${id}" in --rule. Run \`ctx-lint check --help\` for the rule list.`,
      );
    overrides[id] = severity as Severity;
  }
  return overrides;
}
