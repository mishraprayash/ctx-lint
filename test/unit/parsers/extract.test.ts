import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../../src/core/references.js';
import { extractCandidates } from '../../../src/parsers/extract.js';
import { parseMarkdown } from '../../../src/parsers/markdown.js';

function extract(content: string): Candidate[] {
  return extractCandidates({ path: 'CLAUDE.md', content, markdown: parseMarkdown(content) });
}

/** The source text a candidate's range points at. */
function at(content: string, c: Candidate): string {
  return content.slice(c.range.start.offset, c.range.end.offset);
}

describe('extractCandidates', () => {
  it('extracts inline code with exact ranges and sentence context', () => {
    const md = 'Intro.\n\n- Use `zod` for validation and `src/auth/` for guards.\n';
    const found = extract(md);
    expect(found.map((c) => [c.raw, c.origin, c.range.start.line, c.range.start.column])).toEqual([
      ['zod', 'inlineCode', 3, 8],
      ['src/auth/', 'inlineCode', 3, 33],
    ]);
    for (const c of found) expect(at(md, c)).toBe(c.raw);
    expect(found[0]?.context).toEqual({
      text: 'Use zod for validation and src/auth/ for guards.',
      index: 4,
    });
  });

  it('handles double backticks and CommonMark padding', () => {
    const md = 'Run `` npm run `x` `` now.\n';
    const [c] = extract(md);
    expect(c?.raw).toBe('npm run `x`');
    expect(at(md, c as Candidate)).toBe('npm run `x`');
  });

  it('extracts inline code inside tables and headings', () => {
    const md =
      '## The `scripts/` folder\n\n| Cmd | Notes |\n|---|---|\n| `pnpm build` | builds |\n';
    expect(extract(md).map((c) => [c.raw, c.range.start.line])).toEqual([
      ['scripts/', 1],
      ['pnpm build', 5],
    ]);
  });

  it('reads shell blocks line by line, stripping prompts and comments', () => {
    const md = [
      '```bash',
      '# install first',
      '$ pnpm install',
      '',
      'CI=1 npm run test:e2e',
      '```',
    ].join('\n');
    const found = extract(md);
    expect(found.map((c) => [c.raw, c.range.start.line, c.range.start.column])).toEqual([
      ['pnpm install', 3, 3],
      ['CI=1 npm run test:e2e', 5, 1],
    ]);
    for (const c of found) expect(at(md, c)).toBe(c.raw);
  });

  it('joins backslash continuations and maps positions across lines', () => {
    const md = '```sh\nmake \\\n  migrate\n```\n';
    const [c] = extract(md);
    expect(c?.raw).toBe('make  migrate');
    const target = c?.raw.indexOf('migrate') ?? -1;
    const range = c?.locate(target, target + 'migrate'.length);
    expect(range?.start).toMatchObject({ line: 3, column: 3 });
    expect(md.slice(range?.start.offset, range?.end.offset)).toBe('migrate');
  });

  it('only reads prompt lines in console blocks', () => {
    const md =
      '```console\n$ npm test\n\n> ctx-lint@0.0.0 test\n> vitest run\n\nPASS  src/a.test.ts\n```\n';
    expect(extract(md).map((c) => c.raw)).toEqual(['npm test']);
  });

  it('treats unlabelled blocks as shell and ignores other languages', () => {
    const md =
      '```\nmake build\n```\n\n```json\n{ "x": "npm run nope" }\n```\n\n```md\n`src/x.ts`\n```\n';
    expect(extract(md).map((c) => c.raw)).toEqual(['make build']);
  });

  it('locates code inside list items (stripped container indentation)', () => {
    const md = '1. Build:\n\n   ```sh\n   pnpm build\n   ```\n';
    const [c] = extract(md);
    expect(c?.range.start).toMatchObject({ line: 4, column: 4 });
    expect(at(md, c as Candidate)).toBe('pnpm build');
  });

  it('extracts import specifiers from JS/TS blocks, including multi-line imports', () => {
    const md = [
      '```ts',
      "import { z } from 'zod';",
      'import {',
      '  a,',
      "} from '@scope/pkg/sub';",
      "import './styles.css';",
      'const x = require("lodash");',
      "vi.mock('node:fs');",
      'const s = \'from "nope"\';',
      '```',
    ].join('\n');
    const found = extract(md);
    expect(found.map((c) => [c.raw, c.origin, c.range.start.line])).toEqual([
      ['zod', 'import', 2],
      ['@scope/pkg/sub', 'import', 5],
      ['./styles.css', 'import', 6],
      ['lodash', 'import', 7],
      ['node:fs', 'import', 8],
    ]);
    for (const c of found) expect(at(md, c)).toBe(c.raw);
  });

  it('extracts link, image and definition destinations but not self-anchors', () => {
    const md = [
      'See [the guide](docs/guide.md#setup) and ![logo](./img/logo.png "Logo").',
      '',
      'Jump to [below](#below). [ref]: ../shared/README.md',
      '',
      '[ref]: ../shared/README.md',
    ].join('\n');
    const found = extract(md);
    expect(found.map((c) => [c.raw, c.origin])).toEqual([
      ['docs/guide.md#setup', 'link'],
      ['./img/logo.png', 'link'],
      ['../shared/README.md', 'link'],
    ]);
    for (const c of found) expect(at(md, c)).toBe(c.raw);
  });

  it('extracts frontmatter globs (arrays and comma-separated strings)', () => {
    const md =
      '---\ndescription: x\nglobs: src/api/**/*.ts, {a,b}/*.md\napplyTo: ["**/*.test.ts"]\n---\nBody\n';
    const found = extract(md);
    expect(found.map((c) => [c.raw, c.frontmatterKey, c.range.start.line])).toEqual([
      ['src/api/**/*.ts', 'globs', 3],
      ['{a,b}/*.md', 'globs', 3],
      ['**/*.test.ts', 'applyTo', 4],
    ]);
    for (const c of found) expect(at(md, c)).toBe(c.raw);
  });
});
