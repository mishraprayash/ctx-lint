import { lstatSync, realpathSync } from 'node:fs';
import type { ProjectContext } from '../core/context.js';
import { relativeTo, toAbsolute } from '../core/paths.js';
import { discover, type LoadedFile } from '../discovery/index.js';
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
  const files = withoutSymlinks(ctx, await discover(ctx, discoverOptions));
  const result = lintFiles(ctx, files, options);
  if (!options.fix) return { ...result, fixed: { files: 0, problems: 0 } };

  const fixed = await writeFixes(files, result);
  if (fixed.problems === 0) return { ...result, fixed };
  // Re-read the fixed files and report what's left.
  const again = withoutSymlinks(ctx, await discover(ctx, discoverOptions));
  return { ...lintFiles(ctx, again, options), fixed };
}

/**
 * Drops instruction files that are symlinks to another file being linted (`CLAUDE.md` →
 * `AGENTS.md`), so each problem is reported once, on the real file.
 */
function withoutSymlinks(ctx: ProjectContext, files: LoadedFile[]): LoadedFile[] {
  const paths = new Set(files.map((f) => f.path));
  return files.filter((file) => {
    const abs = toAbsolute(ctx.root, file.path);
    try {
      if (!lstatSync(abs).isSymbolicLink()) return true;
      const target = relativeTo(realpathSync(ctx.root), realpathSync(abs));
      return target === null || target === file.path || !paths.has(target);
    } catch {
      return true;
    }
  });
}
