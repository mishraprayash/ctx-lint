import type { ProjectContext } from '../core/context.js';
import { dirnameRel, joinRel } from '../core/paths.js';
import { GitRenames } from '../fs/git-renames.js';
import { TextCache } from '../fs/text-cache.js';
import { findJustfile, loadJustRecipes } from './just.js';
import { findMakefile, loadMakeTargets, type TargetSet } from './make.js';
import { loadNpmProject, type NpmProject } from './npm.js';
import { loadPythonDependencies } from './python.js';

export type { TargetSet } from './make.js';
export { hasTarget } from './make.js';
export type { NpmPackage, NpmProject } from './npm.js';
export { binStatus, matchWorkspaces, nearestPackage } from './npm.js';
export { ecosystemOf, normalizePythonName } from './python.js';

/** Lazily loaded project manifests (package.json, Python, Makefiles, justfiles), cached per run. */
export class Manifests {
  readonly text: TextCache;
  private npmProject: NpmProject | undefined;
  private pythonDependencies: ReadonlySet<string> | undefined;
  private readonly targetSets = new Map<string, TargetSet>();

  /** Renames from git history, for "it was renamed to …" suggestions (loaded on first use). */
  readonly renames: GitRenames;

  constructor(private readonly ctx: ProjectContext) {
    this.text = new TextCache(ctx.root);
    this.renames = new GitRenames(ctx.root, ctx.files, ctx.logger);
  }

  get npm(): NpmProject {
    this.npmProject ??= loadNpmProject(this.ctx.files, this.text);
    return this.npmProject;
  }

  /** Normalized names of the Python dependencies declared anywhere in the repo. */
  get python(): ReadonlySet<string> {
    this.pythonDependencies ??= loadPythonDependencies(this.ctx.files, this.text);
    return this.pythonDependencies;
  }

  /**
   * Targets for `tool` run from `dir`: an explicit `file` (relative to `dir`), otherwise the
   * Makefile/justfile in `dir` or its nearest ancestor. `null` when there is none.
   */
  targets(tool: 'make' | 'just', dir: string, file?: string): TargetSet | null {
    const path = file !== undefined ? this.explicit(dir, file) : this.nearest(tool, dir);
    if (path === null) return null;
    let set = this.targetSets.get(path);
    if (!set) {
      set = tool === 'make' ? loadMakeTargets(this.text, path) : loadJustRecipes(this.text, path);
      this.targetSets.set(path, set);
    }
    return set;
  }

  private explicit(dir: string, file: string): string | null {
    for (const candidate of [joinRel(dir, file), joinRel(file)]) {
      if (this.ctx.files.isFile(candidate)) return candidate;
    }
    return null;
  }

  private nearest(tool: 'make' | 'just', dir: string): string | null {
    let current = dir;
    for (;;) {
      const found =
        tool === 'make'
          ? findMakefile(this.ctx.files, current)
          : findJustfile(this.ctx.files, current);
      if (found) return found;
      if (current === '') return null;
      current = dirnameRel(current);
    }
  }
}
