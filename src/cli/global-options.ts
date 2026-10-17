import type { Command } from 'commander';
import { createContext } from '../api/context.js';
import type { ProjectContext } from '../core/context.js';
import { createLogger, type Logger } from '../core/logger.js';
import type { CliIO } from './io.js';

export interface GlobalOptions {
  cwd?: string;
  config?: string;
  color: boolean;
  debug?: boolean;
}

export function globalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

export function loggerFor(options: GlobalOptions, io: CliIO): Logger {
  return createLogger({
    debug: options.debug === true,
    ...(options.color ? {} : { color: false }),
    write: io.stderr,
  });
}

export function contextFor(options: GlobalOptions, logger: Logger): Promise<ProjectContext> {
  return createContext({ root: options.cwd, configPath: options.config, logger });
}
