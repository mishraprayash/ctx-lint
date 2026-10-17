import { Command, Option } from 'commander';
import { NotImplementedError } from '../../core/errors.js';
import { discover } from '../../discovery/index.js';
import { referencesOf } from '../../parsers/references.js';
import { fileListJson, formatFileList, formatReferences, referencesJson } from '../debug-output.js';
import { contextFor, globalOptions, loggerFor } from '../global-options.js';
import type { CliIO } from '../io.js';
import { collect, parseCount } from '../option-parsers.js';

interface CheckOptions {
  format: 'stylish' | 'json' | 'sarif' | 'github' | 'compact';
  listFiles?: boolean;
  dumpRefs?: boolean;
}

export function checkCommand(io: CliIO): Command {
  return new Command('check')
    .description('Lint agent instruction files for broken paths, scripts and dependencies')
    .argument('[files...]', 'files to lint (default: auto-discover)')
    .addOption(
      new Option('--format <format>', 'output format')
        .choices(['stylish', 'json', 'sarif', 'github', 'compact'])
        .default('stylish'),
    )
    .option('--max-warnings <n>', 'exit with an error if warnings exceed this number', parseCount)
    .option('--quiet', 'report errors only')
    .option('--fix', 'apply safe fixes')
    .option('--rule <id=severity>', 'override a rule severity (repeatable)', collect, [])
    .option('--no-deps', 'skip dependency checks')
    .option('--list-files', 'print the instruction files that would be linted, then exit')
    .option(
      '--dump-refs',
      'print every reference found (with --debug: ignored ones too), then exit',
    )
    .action(async (fileArgs: string[], options: CheckOptions, command: Command) => {
      const globals = globalOptions(command);
      const logger = loggerFor(globals, io);
      const ctx = await contextFor(globals, logger);
      // With --cwd, file arguments are relative to that directory, like the rest of the run.
      const files = await discover(ctx, {
        files: fileArgs,
        cwd: globals.cwd !== undefined ? ctx.root : process.cwd(),
      });
      const json = options.format === 'json';

      if (options.listFiles) {
        io.stdout(
          json
            ? `${JSON.stringify(fileListJson(ctx, files), null, 2)}\n`
            : formatFileList(ctx, files, logger.colors),
        );
        return;
      }

      if (options.dumpRefs) {
        const entries = files.map((file) => ({ file, refs: referencesOf(ctx, file) }));
        const includeIgnored = logger.debugEnabled;
        io.stdout(
          json
            ? `${JSON.stringify(referencesJson(entries, includeIgnored), null, 2)}\n`
            : formatReferences(entries, logger.colors, includeIgnored),
        );
        return;
      }

      throw new NotImplementedError('ctx-lint check');
    });
}
