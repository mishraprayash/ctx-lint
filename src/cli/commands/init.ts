import { Command } from 'commander';
import { NotImplementedError } from '../../core/errors.js';

export function initCommand(): Command {
  return new Command('init')
    .description('Scaffold .context/ (or import existing instruction files with --import)')
    .option(
      '--import',
      'convert existing CLAUDE.md, AGENTS.md, Cursor and Copilot files into source rules',
    )
    .option('--split', 'with --import: create one rule per H2 section')
    .action(() => {
      throw new NotImplementedError('ctx-lint init');
    });
}
