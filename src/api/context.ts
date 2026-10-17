import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/load.js';
import type { ProjectContext } from '../core/context.js';
import { UsageError } from '../core/errors.js';
import { type Logger, silentLogger } from '../core/logger.js';
import { FileIndex } from '../fs/file-index.js';

export interface ContextOptions {
  /** Project root. Default: the nearest ancestor of process.cwd() containing `.git`. */
  root?: string | undefined;
  /** Config file path. Default: `<root>/.context/config.json` if it exists. */
  configPath?: string | undefined;
  logger?: Logger | undefined;
}

export async function createContext(options: ContextOptions = {}): Promise<ProjectContext> {
  const logger = options.logger ?? silentLogger;
  const root = options.root ? path.resolve(options.root) : findProjectRoot(process.cwd());
  if (!existsSync(root)) throw new UsageError(`Project root does not exist: ${root}`);
  logger.debug(`Project root: ${root}`);

  const [{ config, path: configPath }, files] = await Promise.all([
    loadConfig({ root, configPath: options.configPath }),
    timed(logger, 'Indexed files', () =>
      FileIndex.build(root, {
        onError: (dir, error) => logger.debug(`Cannot read ${dir || '.'}: ${String(error)}`),
      }),
    ),
  ]);
  logger.debug(configPath ? `Config: ${configPath}` : 'Config: none found, using defaults');
  const { files: fileCount, dirs } = files.size;
  logger.debug(`Index: ${fileCount} files, ${dirs} directories`);

  return { root, config, configPath, files, logger };
}

/** The nearest ancestor of `start` (inclusive) that contains `.git`, or `start` itself. */
export function findProjectRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    // `.git` is a directory in a normal clone and a file in worktrees and submodules.
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

async function timed<T>(logger: Logger, label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await fn();
  logger.debug(`${label} in ${Math.round(performance.now() - started)} ms`);
  return result;
}
