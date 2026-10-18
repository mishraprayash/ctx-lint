import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';
import type { Diagnostic } from '../../../src/core/types.js';
import { applyFixesToText, fixesHeld } from '../../../src/linter/fix.js';
import { fixturePath } from './helpers.js';

const at = (start: number, end: number, replacement?: string): Diagnostic => ({
  ruleId: 'x',
  severity: 'error',
  message: '',
  file: 'f',
  range: {
    start: { line: 1, column: start + 1, offset: start },
    end: { line: 1, column: end + 1, offset: end },
  },
  ...(replacement !== undefined ? { suggestion: { message: '', replacement } } : {}),
});

describe('applyFixesToText', () => {
  it('applies replacements and skips overlapping ones', () => {
    const { text, applied } = applyFixesToText('aaa bbb ccc', [
      at(8, 11, 'CCC'),
      at(0, 3, 'A'),
      at(1, 2, 'overlaps'),
      at(4, 7), // no replacement
    ]);
    expect(text).toBe('A bbb CCC');
    expect(applied).toBe(2);
  });
});

describe('fixesHeld', () => {
  const d = (ruleId: string, message: string): Diagnostic => ({ ...at(0, 1), ruleId, message });
  const moved = d('path-exists', 'Path "a.ts" does not exist.');
  const other = d('script-exists', 'Script "x" is not defined.');

  it('accepts a fix when its problem is gone and nothing new appeared', () => {
    expect(fixesHeld([moved, other], [moved], [other])).toBe(true);
  });

  it('rejects a fix whose problem is still there', () => {
    expect(fixesHeld([moved], [moved], [moved])).toBe(false);
  });

  it('rejects a fix that introduced a new problem', () => {
    const broke = d('path-exists', 'Path "b.ts" does not exist.');
    expect(fixesHeld([moved], [moved], [broke])).toBe(false);
  });
});

describe('check --fix', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('rewrites moved and mis-cased paths, then reports what is left', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-fix-'));
    await cp(fixturePath('monorepo'), dir, { recursive: true });
    const ctx = await createContext({ root: dir });
    const result = await check(ctx, { fix: true });

    expect(result.fixed).toEqual({ files: 2, problems: 4 });
    expect(result.reverted).toEqual({ files: 0, problems: 0 });
    const root = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(root).toContain('The header is `packages/ui/src/Header.tsx`.');
    expect(root).toContain('The guide is `docs/guide.md`.');
    expect(root).toContain('- Lint with `pnpm run lint`.');
    const web = await readFile(path.join(dir, 'apps/web/CLAUDE.md'), 'utf8');
    expect(web).toContain('The entry is `./src/App.tsx`.');
    expect(result.fixableCount).toBe(0);
    expect(result.errorCount).toBeGreaterThan(0); // Unfixable problems remain.
  });
});
