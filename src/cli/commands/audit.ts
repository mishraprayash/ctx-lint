import { Command, Option } from 'commander';
import { NotImplementedError } from '../../core/errors.js';
import { parseCount } from '../option-parsers.js';

export function auditCommand(): Command {
  return new Command('audit')
    .description('Estimate token cost per agent and check the always-on budget')
    .option('--budget <tokens>', 'always-on token budget per agent', parseCount)
    .addOption(
      new Option('--tokenizer <name>', 'tokenizer to use')
        .choices(['heuristic', 'o200k', 'cl100k'])
        .default('heuristic'),
    )
    .addOption(
      new Option('--format <format>', 'output format').choices(['table', 'json']).default('table'),
    )
    .option('--per-section', 'break down tokens by markdown section')
    .option('--warn-only', 'never exit non-zero for budget overruns')
    .action(() => {
      throw new NotImplementedError('ctx-lint audit');
    });
}
