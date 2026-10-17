import { dirnameRel, joinRel } from '../core/paths.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';
import type { TargetSet } from './make.js';

// Recipe names from a justfile (https://just.systems), following `import`s one level deep.

/** The justfile `just` would use in `dir` (the name is case-insensitive), or `null`. */
export function findJustfile(files: FileIndex, dir: string): string | null {
  const name = files.children(dir).find((child) => /^\.?justfile$/i.test(child));
  if (!name) return null;
  const path = joinRel(dir, name);
  return files.isFile(path) ? path : null;
}

const RECIPE = /^@?([A-Za-z_][\w-]*)(?:\s+[^:]*)?:(?!=)/;
const ALIAS = /^alias\s+([A-Za-z_][\w-]*)\s*:=/;
const IMPORT = /^import\??\s+['"]([^'"]+)['"]/;
const MODULE = /^mod\??\s+([A-Za-z_][\w-]*)/;

interface ParsedJustfile {
  names: Set<string>;
  imports: string[];
  modules: string[];
}

export function parseJustfile(text: string): ParsedJustfile {
  const result: ParsedJustfile = { names: new Set(), imports: [], modules: [] };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) || line.startsWith('#') || line.startsWith('[')) continue; // Body, comment, attribute.
    const alias = ALIAS.exec(line);
    if (alias?.[1]) {
      result.names.add(alias[1]);
      continue;
    }
    const imported = IMPORT.exec(line);
    if (imported?.[1]) {
      result.imports.push(imported[1]);
      continue;
    }
    const module = MODULE.exec(line);
    if (module?.[1]) {
      result.modules.push(module[1]);
      continue;
    }
    if (/^(?:set|export)\s/.test(line)) continue;
    const recipe = RECIPE.exec(line);
    if (recipe?.[1]) result.names.add(recipe[1]);
  }
  return result;
}

export function loadJustRecipes(text: TextCache, justfile: string): TargetSet {
  const parsed = parseJustfile(text.read(justfile) ?? '');
  const dir = dirnameRel(justfile);
  for (const imported of parsed.imports) {
    const source = text.read(joinRel(dir, imported));
    if (source !== null) for (const name of parseJustfile(source).names) parsed.names.add(name);
  }
  // Module recipes are invoked as `just mod::recipe` or `just mod recipe`: accept the module name.
  const patterns = parsed.modules.map((m) => new RegExp(`^${m}(?:::.+)?$`));
  return { file: justfile, names: parsed.names, patterns, dynamic: false };
}
