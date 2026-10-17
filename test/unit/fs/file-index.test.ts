import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileIndex } from '../../../src/fs/file-index.js';

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-index-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

describe('FileIndex.build', () => {
  let root: string;
  let index: FileIndex;

  beforeAll(async () => {
    root = await makeRepo({
      '.gitignore': 'secret.txt\ntmp/\n',
      'CLAUDE.md': '# hi',
      'src/auth/guard.ts': '',
      'src/utils/Date.ts': '',
      'src/.gitignore': 'generated.ts\n',
      'src/generated.ts': '',
      'secret.txt': '',
      'tmp/cache/a.bin': '',
      'node_modules/zod/package.json': '{}',
      'packages/web/CLAUDE.md': '',
    });
    try {
      await symlink(path.join(root, 'src'), path.join(root, 'src-link'), 'dir');
    } catch {
      // Symlinks may need extra privileges on Windows; the symlink assertions are skipped then.
    }
    index = await FileIndex.build(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('indexes files and directories', () => {
    expect(index.isFile('src/auth/guard.ts')).toBe(true);
    expect(index.isDirectory('src/auth')).toBe(true);
    expect(index.isDirectory('src/auth/')).toBe(true);
    expect(index.exists('./src/auth/guard.ts')).toBe(true);
    expect(index.exists('src/auth/guards')).toBe(false);
    expect(index.get('')).toBe('dir');
  });

  it('is case-exact even on case-insensitive filesystems', () => {
    expect(index.exists('src/utils/Date.ts')).toBe(true);
    expect(index.exists('src/utils/date.ts')).toBe(false);
    expect(index.caseVariants('src/utils/date.ts')).toEqual(['src/utils/Date.ts']);
    expect(index.caseVariants('src/utils/Date.ts')).toEqual([]);
  });

  it('marks gitignored entries, including nested .gitignore files', () => {
    expect(index.isFile('secret.txt')).toBe(true);
    expect(index.isIgnored('secret.txt')).toBe(true);
    expect(index.isIgnored('src/generated.ts')).toBe(true);
    expect(index.isIgnored('src/auth/guard.ts')).toBe(false);
  });

  it('does not walk opaque directories but resolves paths below them lazily', () => {
    expect(index.files()).not.toContain('node_modules/zod/package.json');
    expect(index.files()).not.toContain('tmp/cache/a.bin');
    expect(index.isFile('node_modules/zod/package.json')).toBe(true);
    expect(index.isFile('node_modules/ZOD/package.json')).toBe(false);
    expect(index.isFile('tmp/cache/a.bin')).toBe(true);
    expect(index.exists('node_modules/nope')).toBe(false);
  });

  it('finds entries by basename', () => {
    expect(index.byBasename('CLAUDE.md')).toEqual(['CLAUDE.md', 'packages/web/CLAUDE.md']);
    expect(index.byBasename('guard.ts')).toEqual(['src/auth/guard.ts']);
  });

  it('matches globs against indexed files', () => {
    expect(index.match('**/CLAUDE.md')).toEqual(['CLAUDE.md', 'packages/web/CLAUDE.md']);
    expect(index.match(['src/**/*.ts'])).toEqual([
      'src/auth/guard.ts',
      'src/generated.ts',
      'src/utils/Date.ts',
    ]);
    expect(index.match('**/.gitignore')).toEqual(['.gitignore', 'src/.gitignore']);
  });

  it('records symlinked directories without following them', () => {
    if (!index.exists('src-link')) return;
    expect(index.isDirectory('src-link')).toBe(true);
    expect(index.files().some((f) => f.startsWith('src-link/'))).toBe(false);
    expect(index.isFile('src-link/auth/guard.ts')).toBe(true);
  });
});

describe('FileIndex.fromPaths', () => {
  const index = FileIndex.fromPaths('/repo', ['src/a.ts', 'src/b/', 'docs/guide.md']);

  it('implies parent directories', () => {
    expect(index.isDirectory('src')).toBe(true);
    expect(index.isDirectory('src/b')).toBe(true);
    expect(index.children('')).toEqual(['docs', 'src']);
    expect(index.children('src')).toEqual(['a.ts', 'b']);
  });

  it('reports sizes', () => {
    expect(index.size).toEqual({ files: 2, dirs: 4 });
  });
});
