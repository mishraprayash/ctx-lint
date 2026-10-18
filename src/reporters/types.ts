import type { Colors } from '../core/logger.js';
import type { LintResult } from '../linter/engine.js';

export interface ReportContext {
  /** Absolute project root (paths in results are relative to it). */
  root: string;
  colors: Colors;
  version: string;
}

/** Turns a lint result into text for stdout. Pure: no I/O. */
export type Reporter = (result: LintResult, ctx: ReportContext) => string;

export const FORMATS = ['stylish', 'json', 'compact', 'github', 'sarif', 'agent'] as const;
export type Format = (typeof FORMATS)[number];
