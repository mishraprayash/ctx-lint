import { Command } from 'commander';
import { init } from '../../api/init.js';
import { contextFor, globalOptions, loggerFor } from '../global-options.js';
import type { CommandRuntime } from '../io.js';

interface InitCliOptions {
  import?: boolean;
  split?: boolean;
}

export function initCommand(runtime: CommandRuntime): Command {
  return new Command('init')
    .description('Scaffold .context/ (or import existing instruction files with --import)')
    .option(
      '--import',
      'convert existing CLAUDE.md, AGENTS.md, Cursor, Copilot and Windsurf files into source rules',
    )
    .option('--split', 'with --import: create one rule per H2 section of CLAUDE.md, AGENTS.md…')
    .action(async (options: InitCliOptions, command: Command) => {
      const globals = globalOptions(command);
      const logger = loggerFor(globals, runtime);
      const c = logger.colors;
      const ctx = await contextFor(globals, logger);
      const result = await init(ctx, {
        import: options.import === true,
        split: options.split === true,
      });

      for (const path of result.created) runtime.stdout(`  ${c.green('+ create ')} ${path}\n`);
      if (result.configExisted)
        runtime.stdout(`  ${c.dim('= kept    .context/config.json (already exists)')}\n`);

      const imported = result.imported;
      if (imported) {
        for (const rule of imported.rules) {
          runtime.stdout(`  ${c.dim(`${rule.id} ← ${rule.from.join(', ')}`)}\n`);
        }
        for (const { path, reason } of imported.skipped)
          runtime.stdout(`  ${c.dim(`skipped ${path}: ${reason}`)}\n`);
        for (const note of imported.notes) logger.warn(note);
        if (imported.rules.length === 0) {
          runtime.stdout(
            'Nothing to import: no hand-written agent instruction files were found.\n',
          );
          return;
        }
        runtime.stdout(
          [
            '',
            `${c.green('✔')} Imported ${imported.rules.length} rule${imported.rules.length === 1 ? '' : 's'} into ${ctx.config.sources}.`,
            'Next:',
            `  1. Review the rules (always-applied rules cost tokens on every request; scope them with \`globs\`).`,
            '  2. Preview: ctx-lint sync --dry-run --force',
            '  3. Replace your existing files with generated ones: ctx-lint sync --force',
            '',
          ].join('\n'),
        );
        return;
      }

      runtime.stdout(
        [
          '',
          `${c.green('✔')} Set up ctx-lint for: ${result.enabledTargets.join(', ')}.`,
          `Edit the rules in ${ctx.config.sources}, then run \`ctx-lint sync\`.`,
          'Already have CLAUDE.md, AGENTS.md or Cursor rules? Run `ctx-lint init --import` instead.',
          '',
        ].join('\n'),
      );
    });
}
