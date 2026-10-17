import { dirnameRel, joinRel } from '../core/paths.js';
import type { PackageManager } from '../core/references.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';

export type DependencyKind =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export interface NpmPackage {
  /** Repo-relative directory ('' for the root). */
  dir: string;
  /** Repo-relative path of the package.json. */
  path: string;
  name?: string;
  scripts: ReadonlyMap<string, string>;
  dependencies: ReadonlyMap<string, DependencyKind>;
  /** Executables this package itself provides (`bin`). */
  bins: ReadonlySet<string>;
  /** The `packageManager` field, e.g. `pnpm@9.1.0`. */
  packageManager?: string;
}

export interface NpmProject {
  /** Every package.json in the index, sorted by directory. */
  packages: readonly NpmPackage[];
  /** The package manager the repo uses, and how we know. `null` if unknown or ambiguous. */
  packageManager: { name: PackageManager; source: string } | null;
}

const LOCKFILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['pnpm-workspace.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

export function loadNpmProject(files: FileIndex, text: TextCache): NpmProject {
  const packages: NpmPackage[] = [];
  for (const path of files.match(['package.json', '**/package.json'])) {
    const pkg = parsePackageJson(path, text.read(path));
    if (pkg) packages.push(pkg);
  }
  packages.sort((a, b) => a.dir.localeCompare(b.dir));
  return { packages, packageManager: detectPackageManager(files, packages) };
}

function parsePackageJson(path: string, source: string | null): NpmPackage | null {
  if (source === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return null; // A broken package.json is someone else's problem; don't guess.
  }
  if (typeof json !== 'object' || json === null) return null;
  const data = json as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name : undefined;

  const scripts = new Map<string, string>();
  for (const [key, value] of Object.entries(asRecord(data.scripts))) {
    if (typeof value === 'string') scripts.set(key, value);
  }

  const dependencies = new Map<string, DependencyKind>();
  for (const kind of DEPENDENCY_KINDS) {
    for (const dep of Object.keys(asRecord(data[kind]))) {
      if (!dependencies.has(dep)) dependencies.set(dep, kind);
    }
  }

  const bins = new Set<string>();
  if (typeof data.bin === 'string' && name) bins.add(name.split('/').pop() as string);
  for (const bin of Object.keys(asRecord(data.bin))) bins.add(bin);

  return {
    dir: dirnameRel(path),
    path,
    ...(name !== undefined ? { name } : {}),
    scripts,
    dependencies,
    bins,
    ...(typeof data.packageManager === 'string' ? { packageManager: data.packageManager } : {}),
  };
}

function detectPackageManager(
  files: FileIndex,
  packages: readonly NpmPackage[],
): NpmProject['packageManager'] {
  const root = packages.find((p) => p.dir === '');
  if (root) {
    const field = /^(npm|pnpm|yarn|bun)@/.exec(root.packageManager ?? '');
    if (field?.[1])
      return { name: field[1] as PackageManager, source: 'packageManager in package.json' };
  }
  const found = LOCKFILES.filter(([file]) => files.isFile(file));
  const names = new Set(found.map(([, pm]) => pm));
  if (names.size !== 1) return null; // None, or several lockfiles: ambiguous.
  const [file, name] = found[0] as [string, PackageManager];
  return { name, source: file };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The package whose directory is `dir` or its nearest ancestor. */
export function nearestPackage(project: NpmProject, dir: string): NpmPackage | undefined {
  let current = dir;
  for (;;) {
    const pkg = project.packages.find((p) => p.dir === current);
    if (pkg) return pkg;
    if (current === '') return undefined;
    current = dirnameRel(current);
  }
}

/**
 * Packages matching a workspace selector: pnpm `--filter` syntax (`web`, `@acme/*`,
 * `./packages/web`, `{packages/web}`, `web...`, `...^web`), npm `-w` (name or path) and
 * `yarn workspace <name>`. Returns `null` for selectors we can't evaluate (exclusions, git ranges).
 */
export function matchWorkspaces(project: NpmProject, selector: string): NpmPackage[] | null {
  if (selector.startsWith('!') || selector.includes('[')) return null;
  const s = selector.replace(/^\.\.\.\^?|\^?\.\.\.$/g, '').replace(/^\{(.*)\}$/, '$1');
  if (s === '') return null;
  const byDir =
    s.startsWith('./') || s.startsWith('../') || (s.includes('/') && !s.startsWith('@'));
  if (byDir) {
    const dir = joinRel(s.replace(/^\.\//, ''));
    return project.packages.filter((p) => p.dir === dir || p.dir.startsWith(`${dir}/`));
  }
  if (s.includes('*')) {
    const pattern = new RegExp(`^${s.split('*').map(escapeRegex).join('.*')}$`);
    return project.packages.filter((p) => p.name !== undefined && pattern.test(p.name));
  }
  // `web` also matches `@acme/web`, as pnpm does.
  return project.packages.filter(
    (p) => p.name === s || (!s.startsWith('@') && p.name?.split('/').pop() === s),
  );
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Executables whose name differs from the package that provides them. Used when node_modules
 * isn't installed (e.g. in CI before `install`), so `npx tsc` can still be checked.
 */
export const KNOWN_BINS: Readonly<Record<string, readonly string[]>> = {
  astro: ['astro'],
  biome: ['@biomejs/biome'],
  changeset: ['@changesets/cli'],
  commitlint: ['@commitlint/cli'],
  cypress: ['cypress'],
  'drizzle-kit': ['drizzle-kit'],
  eslint: ['eslint'],
  jest: ['jest'],
  'lint-staged': ['lint-staged'],
  next: ['next'],
  nuxi: ['nuxi', 'nuxt'],
  nuxt: ['nuxt'],
  playwright: ['@playwright/test', 'playwright'],
  prettier: ['prettier'],
  prisma: ['prisma'],
  rimraf: ['rimraf'],
  sb: ['storybook'],
  storybook: ['storybook'],
  'svelte-kit': ['@sveltejs/kit'],
  tsc: ['typescript'],
  tsserver: ['typescript'],
  vite: ['vite'],
  vitest: ['vitest'],
  'vue-tsc': ['vue-tsc'],
  wrangler: ['wrangler'],
};

export type BinStatus = 'found' | 'missing' | 'unknown';

/**
 * Whether `name` can be run with `npx`/`pnpm exec` from `dir`. Returns `unknown` when
 * node_modules isn't installed and the name can't be tied to a declared dependency.
 */
export function binStatus(
  project: NpmProject,
  files: FileIndex,
  dir: string,
  name: string,
): BinStatus {
  // 1. Installed executables, from `dir` up to the root.
  let installed = false;
  let current = dir;
  for (;;) {
    const binDir = joinRel(current, 'node_modules/.bin');
    if (files.isDirectory(binDir)) {
      installed = true;
      if (files.exists(joinRel(binDir, name)) || files.exists(joinRel(binDir, `${name}.cmd`)))
        return 'found';
    }
    if (current === '') break;
    current = dirnameRel(current);
  }

  // 2. Declared dependencies and packages in the repo.
  const providers = KNOWN_BINS[name] ?? [name];
  for (const pkg of project.packages) {
    if (pkg.bins.has(name)) return 'found';
    if (providers.some((provider) => pkg.dependencies.has(provider))) return 'found';
  }
  return installed ? 'missing' : 'unknown';
}
