import { describe, expect, it } from 'vitest';
import type { Classification } from '../../../src/core/references.js';
import { FileIndex } from '../../../src/fs/file-index.js';
import { type ClassifyContext, classify } from '../../../src/parsers/classify/index.js';
import { extractCandidates } from '../../../src/parsers/extract.js';
import { parseMarkdown } from '../../../src/parsers/markdown.js';
import {
  type Case,
  CODE_BLOCKS,
  INLINE_COMMANDS,
  INLINE_PATHS,
  LINKS_IMPORTS_FRONTMATTER,
  PACKAGES,
  REPO_FILES,
} from './classify.cases.js';

const files = FileIndex.fromPaths('/repo', REPO_FILES);
const baseCtx: ClassifyContext = { files, fileDir: '', aliases: {}, ignorePatterns: [] };

function classifyMarkdown(markdown: string, ctx: ClassifyContext = baseCtx): Classification[] {
  const candidates = extractCandidates({
    path: 'CLAUDE.md',
    content: markdown,
    markdown: parseMarkdown(markdown),
  });
  return candidates.flatMap((candidate) => classify(candidate, ctx));
}

function summarize(c: Classification): string {
  switch (c.kind) {
    case 'path':
      return join([
        'path',
        `${c.value}${c.isDir ? '/' : ''}`,
        c.confidence,
        c.isGlob && 'glob',
        c.bare && 'bare',
        c.fromFile && 'file',
        c.rooted && 'rooted',
        c.anchor !== undefined && `#${c.anchor}`,
      ]);
    case 'script':
      return join([
        'script',
        c.tool,
        c.name,
        c.confidence,
        c.workspace !== undefined && `ws=${c.workspace}`,
        c.dir !== undefined && `dir=${c.dir}`,
        c.recursive && '-r',
        c.orBin && 'orBin',
        c.ifPresent && 'if-present',
      ]);
    case 'target':
      return join([
        'target',
        c.tool,
        c.name,
        c.confidence,
        c.dir !== undefined && `dir=${c.dir}`,
        c.file !== undefined && `file=${c.file}`,
      ]);
    case 'bin':
      return join(['bin', c.tool, c.name, c.confidence]);
    case 'package':
      return join(['pkg', c.name, c.confidence, c.negated && 'negated']);
    case 'ignored':
      return `ignored ${c.reason}`;
  }
}

function join(parts: readonly (string | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
}

const suites: [string, readonly Case[]][] = [
  ['inline paths', INLINE_PATHS],
  ['inline commands', INLINE_COMMANDS],
  ['package mentions', PACKAGES],
  ['links, imports and frontmatter', LINKS_IMPORTS_FRONTMATTER],
  ['code blocks', CODE_BLOCKS],
];

describe.each(suites)('classify: %s', (_name, cases) => {
  it.each(cases)('%s', (markdown, expected) => {
    expect(classifyMarkdown(markdown).map(summarize)).toEqual(expected);
  });
});

describe('classify: configuration', () => {
  it('expands configured aliases', () => {
    const ctx = { ...baseCtx, aliases: { '@/': 'src/' } };
    expect(classifyMarkdown('`@/components/Button.tsx`', ctx).map(summarize)).toEqual([
      'path src/components/Button.tsx high',
    ]);
  });

  it('skips candidates matching check.ignorePatterns', () => {
    const ctx = { ...baseCtx, ignorePatterns: [/^generated\//] };
    expect(classifyMarkdown('`generated/types.ts` and `npm run x`', ctx).map(summarize)).toEqual([
      'ignored user-pattern',
      'script npm x high',
    ]);
  });

  it('resolves ./ links from a nested instruction file, and other paths from the root up', () => {
    const ctx = { ...baseCtx, fileDir: 'packages/web' };
    const md = '[entry](./src/index.ts), `./src/index.ts` and `src/app.tsx`';
    expect(classifyMarkdown(md, ctx).map(summarize)).toEqual([
      'path packages/web/src/index.ts high file',
      'path src/index.ts high',
      'path src/app.tsx high',
    ]);
  });
});

describe('classify: ranges', () => {
  it('points at the script name inside a command', () => {
    const md = 'Run `CI=1 npm run test:e2e` first.';
    const [ref] = classifyMarkdown(md);
    expect(ref?.kind).toBe('script');
    if (ref?.kind !== 'script') return;
    expect(md.slice(ref.range.start.offset, ref.range.end.offset)).toBe('test:e2e');
  });

  it('points at the path inside an inline token', () => {
    const md = '- See `` src/auth/guard.ts `` for details.';
    const [ref] = classifyMarkdown(md);
    if (ref?.kind !== 'path') throw new Error('expected a path');
    expect(md.slice(ref.range.start.offset, ref.range.end.offset)).toBe('src/auth/guard.ts');
  });
});

it('has at least 200 table-driven cases', () => {
  expect(suites.reduce((n, [, cases]) => n + cases.length, 0)).toBeGreaterThanOrEqual(200);
});
