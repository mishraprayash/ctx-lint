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

export function classifyContextFor(ctx: ProjectContext, filePath: string): ClassifyContext {
  return {
    files: ctx.files,
    fileDir: dirnameRel(filePath),
    aliases: ctx.config.check.aliases,
    ignorePatterns: ctx.config.check.ignorePatterns.map((p) => new RegExp(p)),
  };
}
