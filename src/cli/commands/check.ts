import { Command, Option } from 'commander';
import { NotImplementedError } from '../../core/errors.js';
import { collect, parseCount } from '../option-parsers.js';

export function checkCommand(): Command {
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
    .action(() => {
      throw new NotImplementedError('ctx-lint check');
    });
}
