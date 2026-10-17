import { describe, expect, it } from 'vitest';
import { FileIndex } from '../../../src/fs/file-index.js';
import { parseJustfile } from '../../../src/manifests/just.js';
import { hasTarget, parseMakefile } from '../../../src/manifests/make.js';
import {
  binStatus,
  matchWorkspaces,
  type NpmPackage,
  type NpmProject,
  nearestPackage,
} from '../../../src/manifests/npm.js';

describe('parseMakefile', () => {
  const parsed = parseMakefile(
    [
      'VERSION := 1.0',
      'CC = gcc -o a:b',
      '.PHONY: build clean deploy',
      '',
      'build: deps ## Build it',
      '\tgo build ./... # recipe: not-a-target:',
      'test lint:: build',
      '\t@echo hi',
      '%.o: %.c',
      '$(BIN): main.go',
      'release: VERSION = 2.0',
      'define TEMPLATE',
      'inside: define',
      'endef',
      'multi \\',
      '  line: x',
      '-include local.mk other.mk',
      '# commented: out',
    ].join('\n'),
  );

  it('finds targets, including .PHONY declarations and target-specific variables', () => {
    expect([...parsed.names].sort()).toEqual(
      ['build', 'clean', 'deploy', 'line', 'lint', 'multi', 'release', 'test'].sort(),
    );
  });

  it('ignores variables, recipes, define blocks and comments', () => {
    for (const name of ['VERSION', 'CC', 'go', 'inside', 'commented', 'not-a-target']) {
      expect(parsed.names.has(name)).toBe(false);
    }
  });

  it('records pattern rules, computed targets and includes', () => {
    expect(hasTarget({ file: 'Makefile', ...parsed }, 'main.o')).toBe(true);
    expect(parsed.dynamic).toBe(true);
    expect(parsed.includes).toEqual(['local.mk', 'other.mk']);
  });
});

describe('parseJustfile', () => {
  it('finds recipes, aliases, imports and modules', () => {
    const parsed = parseJustfile(
      [
        'set shell := ["bash", "-c"]',
        'export FOO := "1"',
        "import 'ci.just'",
        'mod deploy',
        'alias b := build',
        '',
        '# Build everything',
        '[private]',
        'build target="all": deps',
        '    cargo build',
        '@test *args:',
        '  cargo test {{args}}',
        'version := "1.0"',
      ].join('\n'),
    );
    expect([...parsed.names].sort()).toEqual(['b', 'build', 'test']);
    expect(parsed.imports).toEqual(['ci.just']);
    expect(parsed.modules).toEqual(['deploy']);
  });
});

describe('npm workspaces', () => {
  const pkg = (dir: string, name?: string, bins: string[] = []): NpmPackage => ({
    dir,
    path: dir === '' ? 'package.json' : `${dir}/package.json`,
    ...(name ? { name } : {}),
    scripts: new Map(),
    dependencies: new Map([['typescript', 'devDependencies' as const]]),
    bins: new Set(bins),
  });
  const project: NpmProject = {
    packages: [
      pkg('', 'root'),
      pkg('apps/web', '@acme/web'),
      pkg('packages/ui', '@acme/ui', ['ui-cli']),
    ],
    packageManager: null,
  };
  const names = (selector: string) => matchWorkspaces(project, selector)?.map((p) => p.dir) ?? null;

  it.each([
    ['@acme/web', ['apps/web']],
    ['web', ['apps/web']],
    ['@acme/*', ['apps/web', 'packages/ui']],
    ['./apps/web', ['apps/web']],
    ['{packages/ui}', ['packages/ui']],
    ['apps/web', ['apps/web']],
    ['web...', ['apps/web']],
    ['...^ui', ['packages/ui']],
    ['nope', []],
  ])('%s', (selector, expected) => {
    expect(names(selector)).toEqual(expected);
  });

  it('cannot evaluate exclusions or git ranges', () => {
    expect(names('!web')).toBeNull();
    expect(names('[origin/main]')).toBeNull();
  });

  it('finds the nearest package for a directory', () => {
    expect(nearestPackage(project, 'apps/web/src/components')?.dir).toBe('apps/web');
    expect(nearestPackage(project, 'docs')?.dir).toBe('');
  });

  it('resolves bins from node_modules, dependencies and known names', () => {
    const noModules = FileIndex.fromPaths('/r', ['package.json']);
    expect(binStatus(project, noModules, '', 'tsc')).toBe('found'); // typescript is a dependency
    expect(binStatus(project, noModules, '', 'ui-cli')).toBe('found'); // provided by a workspace
    expect(binStatus(project, noModules, '', 'unknown-tool')).toBe('unknown');
    const installed = FileIndex.fromPaths('/r', ['package.json', 'node_modules/.bin/eslint']);
    expect(binStatus(project, installed, 'apps/web', 'eslint')).toBe('found');
    expect(binStatus(project, installed, '', 'unknown-tool')).toBe('missing');
  });
});
