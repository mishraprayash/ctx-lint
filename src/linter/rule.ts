import type { ProjectContext } from '../core/context.js';
import type { Reference } from '../core/references.js';
import type { Range, Severity } from '../core/types.js';
import type { LoadedFile } from '../discovery/index.js';
import type { Manifests } from '../manifests/index.js';

export interface RuleMeta {
  description: string;
  defaultSeverity: Severity;
  /** Some reports carry a replacement that `--fix` can apply. */
  fixable?: boolean;
}

export interface ReportDescriptor {
  message: string;
  range: Range;
  suggestion?: { message: string; replacement?: string; candidates?: string[] };
  /** Report as a warning even if the rule is configured as an error (never upgrades). */
  downgrade?: boolean;
}

export interface RuleContext {
  project: ProjectContext;
  manifests: Manifests;
  file: LoadedFile;
  /** Directory of the file being linted, repo-relative. */
  fileDir: string;
  /** True when the path matches `check.ignorePaths`. */
  isIgnoredPath(path: string): boolean;
  report(descriptor: ReportDescriptor): void;
}

/**
 * A lint rule. Reference rules implement `reference` (called for every reference above
 * `check.minConfidence`) and check `ref.kind` themselves; file rules implement `file`.
 */
export interface LintRule {
  id: string;
  meta: RuleMeta;
  reference?(ref: Reference, ctx: RuleContext): void;
  file?(file: LoadedFile, ctx: RuleContext): void;
}
