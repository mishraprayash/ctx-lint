import path from 'node:path';
import { Command, Option } from 'commander';
import type { ProjectContext } from '../../core/context.js';
import { NotImplementedError } from '../../core/errors.js';
import type { Colors } from '../../core/logger.js';
import { discover, type LoadedFile } from '../../discovery/index.js';
import { contextFor, globalOptions, loggerFor } from '../global-options.js';
import type { CliIO } from '../io.js';
import { collect, parseCount } from '../option-parsers.js';

interface CheckOptions {
  format: 'stylish' | 'json' | 'sarif' | 'github' | 'compact';
  listFiles?: boolean;
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
    .action(async (fileArgs: string[], options: CheckOptions, command: Command) => {
      const globals = globalOptions(command);
      const logger = loggerFor(globals, io);
      const ctx = await contextFor(globals, logger);
      const files = await discover(ctx, { files: fileArgs });

      if (options.listFiles) {
        io.stdout(
          options.format === 'json'
            ? `${JSON.stringify(fileListJson(ctx, files), null, 2)}\n`
            : formatFileList(ctx, files, logger.colors),
        );
        return;
      }

      throw new NotImplementedError('ctx-lint check');
    });
}

function fileListJson(ctx: ProjectContext, files: readonly LoadedFile[]) {
  return {
    root: ctx.root,
    config: ctx.configPath,
    files: files.map(({ path: p, kind, agents, alwaysOn }) => ({
      path: p,
      kind,
      agents,
      alwaysOn,
    })),
  };
}

function formatFileList(ctx: ProjectContext, files: readonly LoadedFile[], c: Colors): string {
  const lines = [
    `${c.dim('Root:  ')} ${ctx.root}`,
    `${c.dim('Config:')} ${ctx.configPath ? path.relative(ctx.root, ctx.configPath) : 'none (using defaults)'}`,
    '',
  ];
  if (files.length === 0) {
    lines.push(c.yellow('No instruction files found.'));
    return `${lines.join('\n')}\n`;
  }

  const width = Math.max(...files.map((f) => f.path.length));
  for (const file of files) {
    const who = file.kind === 'instructions' ? file.agents.join(', ') : file.kind;
    const tags = [c.cyan(who), file.alwaysOn ? c.green('always-on') : ''].filter(Boolean);
    lines.push(`  ${file.path.padEnd(width)}  ${tags.join('  ')}`);
  }
  lines.push('', c.dim(`${files.length} file${files.length === 1 ? '' : 's'}`));
  return `${lines.join('\n')}\n`;
}
