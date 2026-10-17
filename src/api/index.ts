// Public programmatic API. Everything the CLI can do is exported from here (PLAN.md §3.2).

export { defaultConfig, loadConfig, parseConfig } from '../config/load.js';
export type { Config, ConfigInput } from '../config/schema.js';
export { configSchema } from '../config/schema.js';
export type { ProjectContext } from '../core/context.js';
export { ConfigError, CtxLintError, UsageError } from '../core/errors.js';
export { ExitCode } from '../core/exit-codes.js';
export type { Logger } from '../core/logger.js';
export { createLogger } from '../core/logger.js';
export type * from '../core/references.js';
export type * from '../core/types.js';
export { AGENT_IDS } from '../core/types.js';
export { VERSION } from '../core/version.js';
export type { DiscoverOptions, LoadedFile } from '../discovery/index.js';
export { discover } from '../discovery/index.js';
export { FileIndex } from '../fs/file-index.js';
export type { ClassifyContext } from '../parsers/classify/index.js';
export { classify, classifyContextFor } from '../parsers/classify/index.js';
export { extractCandidates } from '../parsers/extract.js';
export { referencesOf } from '../parsers/references.js';
export type { TargetAdapter } from '../targets/adapter.js';
export { getTarget, TARGETS } from '../targets/registry.js';
export type { ContextOptions } from './context.js';
export { createContext, findProjectRoot } from './context.js';
