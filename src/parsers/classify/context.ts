import type { ProjectContext } from '../../core/context.js';
import { dirnameRel } from '../../core/paths.js';
import type { FileIndex } from '../../fs/file-index.js';

/** What the classifier may know about the project. */
export interface ClassifyContext {
  files: FileIndex;
  /** Directory (repo-relative) of the instruction file being classified. */
  fileDir: string;
  /** Alias prefix → replacement, e.g. `{ "@/": "src/" }`. */
  aliases: Readonly<Record<string, string>>;
  /** `check.ignorePatterns`, compiled. */
  ignorePatterns: readonly RegExp[];
}

/**
 * The directory relative paths in a file are resolved against. Source rules are written for
 * where they get compiled (the repo root), not for `.context/rules/`.
 */
export function referenceDir(file: { path: string; kind?: string }): string {
  return file.kind === 'source' ? '' : dirnameRel(file.path);
}

export function classifyContextFor(
  ctx: ProjectContext,
  file: { path: string; kind?: string },
): ClassifyContext {
  return {
    files: ctx.files,
    fileDir: referenceDir(file),
    aliases: ctx.aliases,
    ignorePatterns: ctx.config.check.ignorePatterns.map((p) => new RegExp(p)),
  };
}
