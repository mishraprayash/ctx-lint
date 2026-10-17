import { parse as parseJsonc } from 'jsonc-parser';
import { dirnameRel, joinRel, normalizeRel } from '../core/paths.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';

/**
 * Path aliases from the root tsconfig.json / jsconfig.json `compilerOptions.paths`, as
 * prefix → repo-relative replacement: `{ "@/*": ["./src/*"] }` → `{ "@/": "src/" }`.
 * Follows a local `extends` chain a few levels. Only prefixed wildcard aliases (`x/*`) are used.
 */
export function loadTsconfigAliases(files: FileIndex, text: TextCache): Record<string, string> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    if (files.isFile(name)) return aliasesFrom(name, files, text, 0);
  }
  return {};
}

interface CompilerOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

function aliasesFrom(
  path: string,
  files: FileIndex,
  text: TextCache,
  depth: number,
): Record<string, string> {
  const json = parseJsonc(text.read(path) ?? '{}', [], { allowTrailingComma: true }) as {
    extends?: string | string[];
    compilerOptions?: CompilerOptions;
  } | null;
  if (!json || typeof json !== 'object') return {};

  // Settings from `extends` apply first; this file's own settings override them.
  let inherited: Record<string, string> = {};
  const parents = typeof json.extends === 'string' ? [json.extends] : (json.extends ?? []);
  for (const parent of parents) {
    if (depth >= 4 || !parent.startsWith('.')) continue; // Package configs (`@tsconfig/…`) carry no paths.
    const parentPath = joinRel(
      dirnameRel(path),
      parent.endsWith('.json') ? parent : `${parent}.json`,
    );
    if (files.isFile(parentPath))
      inherited = { ...inherited, ...aliasesFrom(parentPath, files, text, depth + 1) };
  }

  const options = json.compilerOptions ?? {};
  if (!options.paths) return inherited;
  const base = joinRel(dirnameRel(path), options.baseUrl ?? '.');
  const own: Record<string, string> = {};
  for (const [pattern, targets] of Object.entries(options.paths)) {
    const target = Array.isArray(targets) ? targets[0] : undefined;
    if (!target || !pattern.endsWith('*') || !target.endsWith('*')) continue;
    // `"*": ["frontend/*"]` is a module search path, not an alias: rewriting every token with it
    // would turn `setTimeout` into `frontend/setTimeout`. Only prefixed aliases (`@/`, `~lib/`) count.
    if (pattern === '*') continue;
    const replacement = normalizeRel(joinRel(base, target.slice(0, -1)));
    own[pattern.slice(0, -1)] = replacement === '' ? '' : `${replacement}/`;
  }
  return { ...inherited, ...own };
}
