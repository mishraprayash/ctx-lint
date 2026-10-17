import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ParseError, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import type { z } from 'zod';
import { ConfigError } from '../core/errors.js';
import { type Config, configSchema } from './schema.js';

export const DEFAULT_CONFIG_PATH = '.context/config.json';

export interface LoadedConfig {
  config: Config;
  /** Absolute path of the file that was loaded, or `null` when defaults were used. */
  path: string | null;
}

/** The config used when no config file exists. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

/**
 * Loads and validates the config.
 *
 * - With `configPath`, the file must exist.
 * - Without it, `<root>/.context/config.json` is used if present, otherwise the defaults.
 *
 * The file may contain comments and trailing commas (JSONC).
 */
export async function loadConfig(options: {
  root: string;
  configPath?: string | undefined;
}): Promise<LoadedConfig> {
  const explicit = options.configPath !== undefined;
  const file = explicit
    ? path.resolve(options.configPath as string)
    : path.join(options.root, ...DEFAULT_CONFIG_PATH.split('/'));

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (!explicit && isNotFound(error)) return { config: defaultConfig(), path: null };
    throw new ConfigError(`Cannot read config file ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  return { config: parseConfig(text, file), path: file };
}

/** Parses and validates config text. `file` is only used in error messages. */
export function parseConfig(text: string, file: string): Config {
  const errors: ParseError[] = [];
  const raw: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first) {
    const { line, column } = lineColumn(text, first.offset);
    throw new ConfigError(
      `Invalid JSON in ${file}:${line}:${column}: ${printParseErrorCode(first.error)}`,
    );
  }

  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(`Invalid config in ${file}:\n${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

export function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `  - ${where}: ${issue.message}`;
    })
    .join('\n');
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
