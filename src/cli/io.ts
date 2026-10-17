import { ExitCode } from '../core/exit-codes.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const processIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** What a command gets: output streams, and a place to put its exit code. */
export interface CommandRuntime extends CliIO {
  exitCode: ExitCode;
}

export function createRuntime(io: CliIO): CommandRuntime {
  return { ...io, exitCode: ExitCode.Success };
}
