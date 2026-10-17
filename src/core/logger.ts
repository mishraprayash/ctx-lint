import pc from 'picocolors';

export type Colors = ReturnType<typeof pc.createColors>;

export interface Logger {
  readonly colors: Colors;
  readonly debugEnabled: boolean;
  /** Printed only with --debug. */
  debug(message: string): void;
  warn(message: string): void;
}

export interface LoggerOptions {
  debug?: boolean;
  color?: boolean;
  write?: (text: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const colors = pc.createColors(options.color ?? pc.isColorSupported);
  const write = options.write ?? ((text: string) => process.stderr.write(text));
  const debugEnabled = options.debug === true;
  return {
    colors,
    debugEnabled,
    debug(message) {
      if (debugEnabled) write(`${colors.dim(`[debug] ${message}`)}\n`);
    },
    warn(message) {
      write(`${colors.yellow('warning')} ${message}\n`);
    },
  };
}

/** A logger that discards everything. Handy as a default in the programmatic API and tests. */
export const silentLogger: Logger = createLogger({ color: false, write: () => {} });
