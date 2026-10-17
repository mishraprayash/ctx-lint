import { Command, CommanderError } from 'commander';
import pc from 'picocolors';
import { CtxLintError } from '../core/errors.js';
import { ExitCode } from '../core/exit-codes.js';
import { VERSION } from '../core/version.js';
import { auditCommand } from './commands/audit.js';
import { checkCommand } from './commands/check.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { type CliIO, processIO } from './io.js';

export type { CliIO } from './io.js';

export function createProgram(io: CliIO = processIO): Command {
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

  for (const command of [checkCommand(io), syncCommand(), auditCommand(), initCommand()]) {
    // Subcommands inherit the output and exit behavior of the root program.
    command.configureOutput({ writeOut: io.stdout, writeErr: io.stderr }).exitOverride();
    program.addCommand(command);
  }

  return program;
}

/** Runs the CLI and returns the exit code instead of exiting, so it can be tested. */
export async function run(argv: string[], io: CliIO = processIO): Promise<ExitCode> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv);
    return ExitCode.Success;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version surface as CommanderErrors with exitCode 0.
      return error.exitCode === 0 ? ExitCode.Success : ExitCode.Fatal;
    }
    const opts = program.opts<{ debug?: boolean; color?: boolean }>();
    const c = pc.createColors(opts.color !== false && pc.isColorSupported);
    if (error instanceof CtxLintError) {
      io.stderr(`${c.red('error')} ${error.message}\n`);
      return error.exitCode;
    }
    const debug = opts.debug === true;
    io.stderr(
      `${c.red('ctx-lint crashed:')} ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (debug && error instanceof Error && error.stack) {
      io.stderr(`${error.stack}\n`);
    } else {
      io.stderr('Re-run with --debug for a stack trace.\n');
    }
    return ExitCode.Fatal;
  }
}
