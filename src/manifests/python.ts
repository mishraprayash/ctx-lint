import { basenameRel, dirnameRel, joinRel } from '../core/paths.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';

/**
 * Manifests of package ecosystems other than npm. An instruction file whose nearest manifest
 * is one of these talks about that ecosystem's libraries, so npm checks don't apply to it.
 */
const FOREIGN_MANIFESTS: readonly string[] = [
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'mix.exs',
  'pubspec.yaml',
  'Package.swift',
];

/**
 * The ecosystem an instruction file in `dir` belongs to, from the nearest directory (itself or
 * an ancestor) that has a manifest: `'npm'` when that directory has only a package.json,
 * `'other'` when it has another ecosystem's manifest (alone or next to a package.json, where a
 * library name is ambiguous), `null` when no directory up to the root has one.
 */
export function ecosystemOf(files: FileIndex, dir: string): 'npm' | 'other' | null {
  for (let current = dir; ; current = dirnameRel(current)) {
    if (FOREIGN_MANIFESTS.some((name) => files.isFile(joinRel(current, name)))) return 'other';
    if (files.isFile(joinRel(current, 'package.json'))) return 'npm';
    if (current === '') return null;
  }
}

/** PEP 503 normalization: `Typing_Extensions` and `typing-extensions` are the same package. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Normalized names of every Python dependency declared in the repo: pyproject.toml
 * (`[project]` dependencies and optional dependencies, `[dependency-groups]`, Poetry) and
 * requirements*.txt files.
 */
export function loadPythonDependencies(files: FileIndex, text: TextCache): ReadonlySet<string> {
  const names = new Set<string>();
  const add = (requirement: string) => {
    const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement)?.[1];
    if (name) names.add(normalizePythonName(name));
  };

  for (const path of files.match(['pyproject.toml', '**/pyproject.toml'])) {
    for (const requirement of pyprojectRequirements(text.read(path) ?? '')) add(requirement);
  }
  for (const path of files.match(['**/requirements*.txt', 'requirements*.txt'])) {
    if (!/^requirements[^/]*\.txt$/.test(basenameRel(path))) continue;
    for (const line of (text.read(path) ?? '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      add(trimmed);
    }
  }
  return names;
}

/** Requirement strings (and Poetry dependency keys) from a pyproject.toml, without a TOML parser. */
function pyprojectRequirements(source: string): string[] {
  const out: string[] = [];
  // Split into `[section]` bodies; `[[array.of.tables]]` headers end a section too.
  const sections = source.split(/^\s*\[+([^\]\n]+)\]+\s*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const name = (sections[i] as string).trim();
    const body = sections[i + 1] ?? '';
    if (name === 'project') {
      const start = /^\s*dependencies\s*=\s*\[/m.exec(body);
      if (start) out.push(...arrayStrings(body, start.index + start[0].length));
    } else if (name === 'project.optional-dependencies' || name === 'dependency-groups') {
      for (const start of body.matchAll(/^\s*[A-Za-z0-9_.-]+\s*=\s*\[/gm)) {
        out.push(...arrayStrings(body, start.index + start[0].length));
      }
    } else if (/^tool\.poetry(?:\.group\.[^.]+)?\.(?:dev-)?dependencies$/.test(name)) {
      for (const key of body.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=/gm)) {
        if (key[1] !== 'python') out.push(key[1] as string);
      }
    }
  }
  return out;
}

/** The quoted strings of a TOML array whose `[` ends just before `from`. */
function arrayStrings(source: string, from: number): string[] {
  const out: string[] = [];
  let i = from;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === ']') break;
    if (ch === '#') {
      i = source.indexOf('\n', i);
      if (i === -1) break;
    } else if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) break;
      out.push(source.slice(i + 1, end));
      i = end;
    }
    i++;
  }
  return out;
}
