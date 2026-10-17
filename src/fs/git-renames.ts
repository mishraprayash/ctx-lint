import { execFileSync } from 'node:child_process';
import type { Logger } from '../core/logger.js';
import { joinRel, normalizeRel } from '../core/paths.js';
import type { FileIndex } from './file-index.js';

export interface Rename {
  /** Where the path lives now (it exists). */
  to: string;
  /** Short hash of the commit that renamed it (the last one, for chains). */
  commit: string;
}

const MAX_COMMITS = 1000;
const TIMEOUT_MS = 3000;

/**
 * Renames from git history, for "it was renamed to …" suggestions. `git log` runs at most once
 * per run, and only when a missing path is looked up. Outside a git repo (or if git is slow or
 * missing) every lookup returns `null`.
 */
export class GitRenames {
  private renames: Map<string, { to: string; commit: string }> | undefined;

  constructor(
    private readonly root: string,
    private readonly files: FileIndex,
    private readonly logger: Logger,
  ) {}

  /** Where a missing file went, following chains (a → b → c) to a path that exists. */
  file(path: string): Rename | null {
    const map = this.load();
    let current = normalizeRel(path);
    let last: { to: string; commit: string } | undefined;
    for (let hops = 0; hops < 20; hops++) {
      const next = map.get(current);
      if (!next) break;
      last = { to: next.to, commit: last?.commit ?? next.commit };
      current = next.to;
      if (this.files.isFile(current)) return { to: current, commit: next.commit };
    }
    return null;
  }

  /** Where a missing directory went, inferred from the files that moved out of it. */
  directory(dir: string): Rename | null {
    const prefix = `${normalizeRel(dir)}/`;
    const votes = new Map<string, { count: number; commit: string }>();
    for (const [from, { to, commit }] of this.load()) {
      if (!from.startsWith(prefix)) continue;
      const rest = from.slice(prefix.length);
      if (!to.endsWith(`/${rest}`)) continue;
      const newDir = to.slice(0, to.length - rest.length - 1);
      const vote = votes.get(newDir) ?? { count: 0, commit };
      vote.count++;
      votes.set(newDir, vote);
    }
    const [best] = [...votes].sort((a, b) => b[1].count - a[1].count);
    if (!best || !this.files.isDirectory(best[0])) return null;
    return { to: best[0], commit: best[1].commit };
  }

  private load(): Map<string, { to: string; commit: string }> {
    if (this.renames) return this.renames;
    this.renames = new Map();
    let output: string;
    try {
      output = execFileSync(
        'git',
        [
          'log',
          '-M',
          '--diff-filter=R',
          '--name-status',
          '--relative',
          '--format=%h',
          '--no-color',
          '-n',
          String(MAX_COMMITS),
        ],
        {
          cwd: this.root,
          encoding: 'utf8',
          timeout: TIMEOUT_MS,
          maxBuffer: 32 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
    } catch (error) {
      this.logger.debug(
        `git rename lookup unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.renames;
    }
    // Newest first: the first rename seen for a path is its latest.
    let commit = '';
    for (const line of output.split('\n')) {
      const parts = line.split('\t');
      if (parts.length === 1) {
        if (line.trim() !== '') commit = line.trim();
      } else if (parts[0]?.startsWith('R') && parts[1] && parts[2]) {
        const from = joinRel(parts[1]);
        if (!this.renames.has(from)) this.renames.set(from, { to: joinRel(parts[2]), commit });
      }
    }
    this.logger.debug(`git: ${this.renames.size} renames in the last ${MAX_COMMITS} commits`);
    return this.renames;
  }
}
