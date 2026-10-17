import { dirnameRel, joinRel } from '../core/paths.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';

// Just enough Makefile parsing to list target names (PLAN.md §1.4: not full make semantics).

export interface TargetSet {
  /** Repo-relative path of the file that was parsed. */
  file: string;
  names: ReadonlySet<string>;
  /** Pattern rules (`%.o: %.c`) as regular expressions. */
  patterns: readonly RegExp[];
  /** Some targets are computed (`$(BIN): …`), so a missing name may still exist. */
  dynamic: boolean;
}

/** Makefile names in GNU make's lookup order. */
const MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile'];

/** The Makefile make would use in `dir`, or `null`. */
export function findMakefile(files: FileIndex, dir: string): string | null {
  for (const name of MAKEFILE_NAMES) {
    const path = joinRel(dir, name);
    if (files.isFile(path)) return path;
  }
  return null;
}

/** Target definition: `name:`, `a b: deps`, `name::` — but not `X := value` or `X = a:b`. */
const RULE = /^([^\s:=#][^:=#]*?)\s*::?(?!=)/;
const INCLUDE = /^-?(?:include|sinclude)\s+(.+)$/;

interface ParsedMakefile {
  names: Set<string>;
  patterns: RegExp[];
  dynamic: boolean;
  includes: string[];
}

export function parseMakefile(text: string): ParsedMakefile {
  const result: ParsedMakefile = { names: new Set(), patterns: [], dynamic: false, includes: [] };
  let inDefine = false;

  for (const raw of joinContinuations(text)) {
    if (raw.startsWith('\t')) continue; // Recipe line.
    const line = raw.replace(/(^|[^\\])#.*$/, '$1').trimEnd();
    if (/^\s*define\b/.test(line)) inDefine = true;
    if (inDefine) {
      if (/^\s*endef\b/.test(line)) inDefine = false;
      continue;
    }

    const include = INCLUDE.exec(line.trim());
    if (include?.[1]) {
      result.includes.push(...include[1].split(/\s+/).filter((f) => f !== '' && !f.includes('$')));
      continue;
    }

    const rule = RULE.exec(line);
    if (!rule?.[1]) continue;
    const special = rule[1].trim();
    // `.PHONY: build clean` declares names; other special targets (.SUFFIXES, …) don't.
    if (special === '.PHONY') {
      const declared = line
        .slice(line.indexOf(':') + 1)
        .trim()
        .split(/\s+/);
      for (const name of declared) if (name !== '' && !name.includes('$')) result.names.add(name);
      continue;
    }
    for (const name of special.split(/\s+/)) {
      if (name === '' || name.startsWith('.')) continue;
      if (name.includes('$')) result.dynamic = true;
      else if (name.includes('%')) result.patterns.push(patternToRegex(name));
      else result.names.add(name);
    }
  }
  return result;
}

/** Loads targets from a Makefile, following `include`s one level deep. */
export function loadMakeTargets(text: TextCache, makefile: string): TargetSet {
  const parsed = parseMakefile(text.read(makefile) ?? '');
  const dir = dirnameRel(makefile);
  for (const include of parsed.includes) {
    const included = text.read(joinRel(dir, include));
    if (included === null) continue;
    const inner = parseMakefile(included);
    for (const name of inner.names) parsed.names.add(name);
    parsed.patterns.push(...inner.patterns);
    parsed.dynamic ||= inner.dynamic;
  }
  return {
    file: makefile,
    names: parsed.names,
    patterns: parsed.patterns,
    dynamic: parsed.dynamic,
  };
}

export function hasTarget(targets: TargetSet, name: string): boolean {
  return targets.names.has(name) || targets.patterns.some((pattern) => pattern.test(name));
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('%', '.+');
  return new RegExp(`^${escaped}$`);
}

/** Splits into logical lines, joining `\` continuations. */
function joinContinuations(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1)} `;
    } else {
      lines.push(current + line);
      current = '';
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
