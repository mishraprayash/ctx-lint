import { ExitCode } from './exit-codes.js';

/**
 * Base class for every error ctx-lint expects to surface to the user.
 * Anything else reaching the CLI boundary is treated as a crash.
 */
export class CtxLintError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, options?: { exitCode?: ExitCode; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.exitCode = options?.exitCode ?? ExitCode.Fatal;
  }
}

export class NotImplementedError extends CtxLintError {
  constructor(feature: string) {
    super(`\`${feature}\` is not implemented yet.`);
  }
}
