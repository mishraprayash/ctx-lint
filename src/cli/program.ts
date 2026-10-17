import { Command, CommanderError } from 'commander';
import pc from 'picocolors';
import { CtxLintError } from '../core/errors.js';
import { ExitCode } from '../core/exit-codes.js';
import { VERSION } from '../core/version.js';
import { auditCommand } from './commands/audit.js';
import { checkCommand } from './commands/check.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function createProgram(io: CliIO = defaultIO): Command {
  const program = new Command('ctx-lint')
    .description('Context linter & sync for AI coding agents')
    .version(VERSION, '-v, --version')
    .option('--cwd <dir>', 'project root (default: nearest git root)')
    .option('--config <path>', 'path to config file (default: .context/config.json)')
    .option('--no-color', 'disable colored output')
    .option('--debug', 'print debug information and stack traces')
    .showHelpAfterError()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();

  for (const command of [checkCommand(), syncCommand(), auditCommand(), initCommand()]) {
    // Subcommands inherit the output and exit behavior of the root program.
    command.configureOutput({ writeOut: io.stdout, writeErr: io.stderr }).exitOverride();
    program.addCommand(command);
  }

  return program;
}

/** Runs the CLI and returns the exit code instead of exiting, so it can be tested. */
export async function run(argv: string[], io: CliIO = defaultIO): Promise<ExitCode> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv);
    return ExitCode.Success;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version surface as CommanderErrors with exitCode 0.
      return error.exitCode === 0 ? ExitCode.Success : ExitCode.Fatal;
    }
    if (error instanceof CtxLintError) {
      io.stderr(`${pc.red('error')} ${error.message}\n`);
      return error.exitCode;
    }
    const debug = program.opts<{ debug?: boolean }>().debug === true;
    io.stderr(
      `${pc.red('ctx-lint crashed:')} ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (debug && error instanceof Error && error.stack) {
      io.stderr(`${error.stack}\n`);
    } else {
      io.stderr('Re-run with --debug for a stack trace.\n');
    }
    return ExitCode.Fatal;
  }
}
