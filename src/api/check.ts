import type { ProjectContext } from '../core/context.js';
import { discover } from '../discovery/index.js';
import { type LintOptions, type LintResult, lintFiles } from '../linter/engine.js';
import { writeFixes } from '../linter/fix.js';

export interface CheckOptions extends LintOptions {
  /** Explicit files instead of discovery (absolute, or relative to `cwd`). */
  files?: readonly string[];
  cwd?: string;
  /** Apply safe fixes to disk, then lint again. */
  fix?: boolean;
}

export interface CheckResult extends LintResult {
  /** What `fix` changed (zeros when not fixing). */
  fixed: { files: number; problems: number };
}

/** Lints the project's instruction files: the programmatic `ctx-lint check`. */
export async function check(ctx: ProjectContext, options: CheckOptions = {}): Promise<CheckResult> {
  const discoverOptions = {
    ...(options.files ? { files: options.files } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  };
  const files = await discover(ctx, discoverOptions);
  const result = lintFiles(ctx, files, options);
  if (!options.fix) return { ...result, fixed: { files: 0, problems: 0 } };

  const fixed = await writeFixes(files, result);
  if (fixed.problems === 0) return { ...result, fixed };
  // Re-read the fixed files and report what's left.
  return { ...lintFiles(ctx, await discover(ctx, discoverOptions), options), fixed };
}
