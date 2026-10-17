import { type Dirent, readdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import picomatch from 'picomatch';
import { basenameRel, dirnameRel, joinRel, normalizeRel, toAbsolute } from '../core/paths.js';

export type EntryType = 'file' | 'dir';

export interface IndexEntry {
  type: EntryType;
  /** Matched by a .gitignore. */
  ignored: boolean;
  /** A directory that was not walked. Paths below it are checked lazily on disk. */
  opaque: boolean;
}

/**
 * Directories that are recorded but never walked: they are huge, generated, or both.
 * References into them still resolve, via a lazy (case-exact) disk lookup.
 */
export const DEFAULT_OPAQUE_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'bower_components',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.terraform',
];

export interface FileIndexOptions {
  /** Directory names (at any depth) that are recorded but not walked. */
  opaqueDirs?: readonly string[];
  /** Honor .gitignore files (default: true). Gitignored directories become opaque. */
  gitignore?: boolean;
  /** Called for directories that can't be read. */
  onError?: (dir: string, error: unknown) => void;
}

const WALK_CONCURRENCY = 64;

/**
 * An in-memory index of the repository, built with one walk. All lookups are synchronous,
 * case-exact (even on case-insensitive filesystems) and take repo-relative POSIX paths.
 */
export class FileIndex {
  readonly root: string;
  private readonly entries = new Map<string, IndexEntry>();
  private readonly childNames = new Map<string, string[]>();
  private readonly lowerCase = new Map<string, string[]>();
  private readonly basenames = new Map<string, string[]>();
  /** Lazy lookups below opaque directories: absolute dir → (name → type). */
  private readonly lazyDirs = new Map<string, Map<string, EntryType> | null>();
  private sortedFiles: string[] | undefined;

  private constructor(root: string) {
    this.root = root;
    this.entries.set('', { type: 'dir', ignored: false, opaque: false });
    this.childNames.set('', []);
  }

  /** Walks `root` and builds the index. */
  static async build(root: string, options: FileIndexOptions = {}): Promise<FileIndex> {
    const index = new FileIndex(path.resolve(root));
    await new Walker(index, options).run();
    return index;
  }

  /**
   * Builds an index from a list of paths, without touching the disk. A trailing "/" marks a
   * directory; parent directories are implied. Intended for tests.
   */
  static fromPaths(
    root: string,
    paths: readonly string[],
    opaque: readonly string[] = [],
  ): FileIndex {
    const index = new FileIndex(root);
    const opaqueSet = new Set(opaque.map(normalizeRel));
    for (const raw of paths) {
      const rel = normalizeRel(raw);
      const type: EntryType = raw.endsWith('/') ? 'dir' : 'file';
      index.addWithParents(rel, type, opaqueSet);
    }
    for (const dir of opaqueSet) index.addWithParents(dir, 'dir', opaqueSet);
    return index;
  }

  /** The type of the entry at `rel`, or `null` if it doesn't exist (exact case). */
  get(rel: string): EntryType | null {
    const p = normalizeRel(rel);
    const entry = this.entries.get(p);
    if (entry) return entry.type;
    const opaqueRoot = this.opaqueAncestor(p);
    return opaqueRoot === null ? null : this.lazyGet(opaqueRoot, p);
  }

  exists(rel: string): boolean {
    return this.get(rel) !== null;
  }

  isFile(rel: string): boolean {
    return this.get(rel) === 'file';
  }

  isDirectory(rel: string): boolean {
    return this.get(rel) === 'dir';
  }

  /** True when the entry (or one of its parent directories) is gitignored. */
  isIgnored(rel: string): boolean {
    let p = normalizeRel(rel);
    for (;;) {
      if (this.entries.get(p)?.ignored) return true;
      if (p === '') return false;
      p = dirnameRel(p);
    }
  }

  /**
   * Indexed paths that equal `rel` ignoring case, excluding an exact match.
   * Used to report case mismatches that only work on case-insensitive filesystems.
   */
  caseVariants(rel: string): readonly string[] {
    const p = normalizeRel(rel);
    return (this.lowerCase.get(p.toLowerCase()) ?? []).filter((candidate) => candidate !== p);
  }

  /** Indexed files and directories with this basename (exact case), sorted. */
  byBasename(name: string): readonly string[] {
    return this.basenames.get(name) ?? [];
  }

  /** Names of the direct children of an indexed directory, sorted. */
  children(dir: string): readonly string[] {
    return this.childNames.get(normalizeRel(dir)) ?? [];
  }

  /** All indexed files, sorted. Files below opaque directories are not included. */
  files(): readonly string[] {
    this.sortedFiles ??= [...this.entries]
      .filter(([, entry]) => entry.type === 'file')
      .map(([p]) => p)
      .sort();
    return this.sortedFiles;
  }

  /** Indexed files matching any of the globs (relative to the repo root), sorted. */
  match(globs: string | readonly string[]): string[] {
    const list = typeof globs === 'string' ? [globs] : [...globs];
    if (list.length === 0) return [];
    const isMatch = picomatch(list, { dot: true });
    return this.files().filter((file) => isMatch(file));
  }

  get size(): { files: number; dirs: number } {
    let files = 0;
    for (const entry of this.entries.values()) if (entry.type === 'file') files++;
    return { files, dirs: this.entries.size - files };
  }

  /** @internal Used by the walker. */
  add(rel: string, entry: IndexEntry): void {
    if (this.entries.has(rel)) return;
    this.entries.set(rel, entry);
    this.sortedFiles = undefined;
    const parent = dirnameRel(rel);
    const name = basenameRel(rel);
    insertSorted(this.childNames, parent, name);
    insertSorted(this.lowerCase, rel.toLowerCase(), rel);
    insertSorted(this.basenames, name, rel);
    if (entry.type === 'dir' && !this.childNames.has(rel)) this.childNames.set(rel, []);
  }

  private addWithParents(rel: string, type: EntryType, opaque: ReadonlySet<string>): void {
    if (rel === '') return;
    const parent = dirnameRel(rel);
    if (!this.entries.has(parent)) this.addWithParents(parent, 'dir', opaque);
    this.add(rel, { type, ignored: false, opaque: opaque.has(rel) });
  }

  private opaqueAncestor(rel: string): string | null {
    let i = rel.indexOf('/');
    while (i !== -1) {
      const prefix = rel.slice(0, i);
      const entry = this.entries.get(prefix);
      if (!entry) return null;
      if (entry.opaque) return prefix;
      i = rel.indexOf('/', i + 1);
    }
    return null;
  }

  /** Resolves `rel` below the opaque directory `base` one segment at a time, exact case. */
  private lazyGet(base: string, rel: string): EntryType | null {
    let dir = toAbsolute(this.root, base);
    const segments = rel.slice(base.length + 1).split('/');
    let type: EntryType | null = 'dir';
    for (const segment of segments) {
      if (type !== 'dir') return null;
      type = this.lazyReaddir(dir)?.get(segment) ?? null;
      if (type === null) return null;
      dir = path.join(dir, segment);
    }
    return type;
  }

  private lazyReaddir(absDir: string): Map<string, EntryType> | null {
    if (this.lazyDirs.has(absDir)) return this.lazyDirs.get(absDir) ?? null;
    let listing: Map<string, EntryType> | null = null;
    try {
      listing = new Map();
      for (const dirent of readdirSync(absDir, { withFileTypes: true })) {
        listing.set(dirent.name, direntTypeSync(dirent, absDir));
      }
    } catch {
      listing = null;
    }
    this.lazyDirs.set(absDir, listing);
    return listing;
  }
}

interface GitignoreScope {
  /** Repo-relative directory the .gitignore lives in. */
  base: string;
  matcher: Ignore;
}

class Walker {
  private readonly opaqueNames: ReadonlySet<string>;
  private readonly gitignore: boolean;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly index: FileIndex,
    private readonly options: FileIndexOptions,
  ) {
    this.opaqueNames = new Set(options.opaqueDirs ?? DEFAULT_OPAQUE_DIRS);
    this.gitignore = options.gitignore ?? true;
  }

  run(): Promise<void> {
    return this.walk('', []);
  }

  private async walk(dir: string, scopes: readonly GitignoreScope[]): Promise<void> {
    const absDir = toAbsolute(this.index.root, dir);
    let dirents: Dirent[];
    try {
      dirents = await this.limited(() => readdir(absDir, { withFileTypes: true }));
    } catch (error) {
      this.options.onError?.(dir, error);
      return;
    }

    let activeScopes = scopes;
    if (this.gitignore && dirents.some((d) => d.name === '.gitignore' && d.isFile())) {
      const text = await this.limited(() => readFile(path.join(absDir, '.gitignore'), 'utf8'));
      activeScopes = [...scopes, { base: dir, matcher: ignore().add(text) }];
    }

    const subdirs: string[] = [];
    for (const dirent of dirents) {
      const rel = joinRel(dir, dirent.name);
      const type = await this.typeOf(dirent, absDir);
      const ignored = this.isGitignored(rel, type, activeScopes);
      // Symlinked directories are recorded but not followed, to avoid cycles.
      const opaque =
        type === 'dir' && (this.opaqueNames.has(dirent.name) || ignored || dirent.isSymbolicLink());
      this.index.add(rel, { type, ignored, opaque });
      if (type === 'dir' && !opaque) subdirs.push(rel);
    }

    await Promise.all(subdirs.map((sub) => this.walk(sub, activeScopes)));
  }

  private async typeOf(dirent: Dirent, absDir: string): Promise<EntryType> {
    if (!dirent.isSymbolicLink()) return dirent.isDirectory() ? 'dir' : 'file';
    try {
      const target = await stat(path.join(absDir, dirent.name));
      return target.isDirectory() ? 'dir' : 'file';
    } catch {
      return 'file'; // Broken symlink: it exists as an entry, so treat it as a file.
    }
  }

  private isGitignored(rel: string, type: EntryType, scopes: readonly GitignoreScope[]): boolean {
    for (const { base, matcher } of scopes) {
      const relToScope = base === '' ? rel : rel.slice(base.length + 1);
      if (matcher.ignores(type === 'dir' ? `${relToScope}/` : relToScope)) return true;
    }
    return false;
  }

  /** Caps concurrent filesystem calls so huge trees don't hit EMFILE. */
  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= WALK_CONCURRENCY) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function direntTypeSync(dirent: Dirent, absDir: string): EntryType {
  if (!dirent.isSymbolicLink()) return dirent.isDirectory() ? 'dir' : 'file';
  try {
    return statSync(path.join(absDir, dirent.name)).isDirectory() ? 'dir' : 'file';
  } catch {
    return 'file';
  }
}

function insertSorted(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (!list) {
    map.set(key, [value]);
    return;
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] as string) < value) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] !== value) list.splice(lo, 0, value);
}
