import type { Config } from '../config/schema.js';
import type { FileIndex } from '../fs/file-index.js';
import type { Logger } from './logger.js';

/** Everything a command knows about the project. Built once per run by `createContext`. */
export interface ProjectContext {
  /** Absolute path of the project root. */
  root: string;
  config: Config;
  /** Absolute path of the loaded config file, or `null` when defaults are used. */
  configPath: string | null;
  files: FileIndex;
  logger: Logger;
}
