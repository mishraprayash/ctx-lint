import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';
import { init } from '../../../src/api/init.js';
import { sync } from '../../../src/api/sync.js';
import { parseMarkdown } from '../../../src/parsers/markdown.js';
import { demoPath, fixturePath } from '../linter/helpers.js';

let dir: string;
const read = (rel: string) => readFile(path.join(dir, rel), 'utf8');
const run = async (options: Parameters<typeof sync>[1] = {}) =>
  sync(await createContext({ root: dir }), options);
const actions = (result: Awaited<ReturnType<typeof sync>>) =>
  result.plan.changes.filter((c) => c.action !== 'unchanged').map((c) => `${c.action} ${c.path}`);

async function copy(from: string): Promise<void> {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-sync-'));
  await cp(from, dir, { recursive: true });
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sync', () => {
  beforeEach(() => copy(demoPath));

  it('refuses to overwrite a hand-written file, and writes nothing at all', async () => {
    const result = await run();
    expect(result.plan.conflicts).toEqual([
      { path: 'CLAUDE.md', reason: 'exists and has no ctx-lint markers' },
    ]);
    expect(result.written).toBe(false);
    await expect(read('AGENTS.md')).rejects.toThrow(); // Not even the files without conflicts.
  });

  it('is idempotent: a second sync changes nothing', async () => {
    const first = await run({ force: true });
    expect(first.written).toBe(true);
    expect(actions(first)).toEqual([
      'create .claude/rules/api.md',
      'create .cursor/rules/api.mdc',
      'create .cursor/rules/general.mdc',
      'create .cursor/rules/testing.mdc',
      'create .github/copilot-instructions.md',
      'create .github/instructions/api.instructions.md',
      'create AGENTS.md',
      'update CLAUDE.md',
    ]);
    const second = await run();
    expect(actions(second)).toEqual([]);
    expect(second.outOfDate).toBe(false);
  });

  it('detects drift after a hand edit, and check reports it', async () => {
    await run({ force: true });
    await writeFile(
      path.join(dir, '.cursor/rules/api.mdc'),
      `${await read('.cursor/rules/api.mdc')}- edited\n`,
    );

    const drift = await run({ dryRun: true });
    expect(drift.outOfDate).toBe(true);
    expect(actions(drift)).toEqual(['update .cursor/rules/api.mdc']);

    const result = await check(await createContext({ root: dir }));
    const rules = result.files.flatMap((f) => f.diagnostics.map((d) => `${f.path} ${d.ruleId}`));
    expect(rules).toContain('.cursor/rules/api.mdc generated-file-modified');
  });

  it('deletes generated files whose rule was removed, and leaves hand-written ones alone', async () => {
    await run({ force: true });
    await writeFile(
      path.join(dir, '.cursor/rules/mine.mdc'),
      '---\nalwaysApply: true\n---\n\nMine.\n',
    );
    await rm(path.join(dir, '.context/rules/testing.md'));
    const result = await run();
    expect(actions(result)).toContain('delete .cursor/rules/testing.mdc');
    expect(actions(result).some((a) => a.includes('mine.mdc'))).toBe(false);
    await expect(read('.cursor/rules/mine.mdc')).resolves.toContain('Mine.');
  });

  it('only replaces the managed block, keeping hand-written content around it', async () => {
    await writeFile(
      path.join(dir, 'CLAUDE.md'),
      '# Team notes\n\nKeep this.\n\n<!-- ctx-lint:begin -->\n<!-- ctx-lint:end -->\n\nAnd this.\n',
    );
    await run();
    const claude = await read('CLAUDE.md');
    expect(claude).toMatch(/^# Team notes\n\nKeep this\.\n\n<!-- ctx-lint:begin hash=/);
    expect(claude).toContain('## General conventions');
    expect(claude.trimEnd().endsWith('And this.')).toBe(true);
  });

  it('dry runs and --target write nothing / only the chosen targets', async () => {
    const dry = await run({ dryRun: true, force: true });
    expect(dry.written).toBe(false);
    await expect(read('AGENTS.md')).rejects.toThrow();

    const only = await run({ targets: ['cursor'] });
    expect(actions(only).every((a) => a.includes('.cursor/'))).toBe(true);
  });

  it('reports invalid source rules and writes nothing', async () => {
    await writeFile(path.join(dir, '.context/rules/bad.md'), '---\nalwaysApply: "yes"\n---\n\nx\n');
    const result = await run({ force: true });
    expect(result.plan.problems).toEqual([
      { file: '.context/rules/bad.md', message: '"alwaysApply" must be true or false (unquoted)' },
    ]);
    expect(result.written).toBe(false);
  });

  it('generated files are valid for their format and pass check', async () => {
    await run({ force: true });
    const mdc = parseMarkdown(await read('.cursor/rules/api.mdc')).frontmatter?.data;
    expect(mdc).toEqual({
      description: 'API route conventions',
      globs: 'src/api/**/*.ts',
      alwaysApply: false,
    });
    const result = await check(await createContext({ root: dir }), {
      rules: { 'glob-matches': 'off' },
    });
    const generatedProblems = result.files
      .filter((f) => !f.path.startsWith('.context/') && f.path !== 'CLAUDE.md')
      .flatMap((f) => f.diagnostics);
    expect(generatedProblems).toEqual([]);
  });
});

describe('init --import round trip', () => {
  beforeEach(() => copy(fixturePath('import-source')));

  it('imports existing files, then sync reproduces them and stays stable', async () => {
    const imported = await init(await createContext({ root: dir }), { import: true, split: true });
    expect(imported.imported?.rules.map((r) => `${r.id} ← ${r.from.join(', ')}`)).toEqual([
      'imported-claude ← CLAUDE.md, AGENTS.md',
      'imported-claude-commands ← CLAUDE.md, AGENTS.md',
      'imported-claude-style ← CLAUDE.md, AGENTS.md',
      'api ← .cursor/rules/api.mdc',
      'release ← .cursor/rules/release.mdc',
      'style ← .cursor/rules/style.mdc',
      'tests ← .github/instructions/tests.instructions.md',
      'imported-packages-web-claude ← packages/web/CLAUDE.md',
    ]);
    expect(imported.imported?.skipped).toEqual([
      { path: 'CLAUDE.local.md', reason: 'personal file (CLAUDE.local.md), not shared' },
    ]);
    expect(await read('.context/rules/api.md')).toBe(
      '---\ndescription: API route conventions\nglobs:\n  - "src/api/**/*.ts"\nalwaysApply: false\n---\n\n- Validate request bodies.\n',
    );

    const first = await run({ force: true });
    expect(first.written).toBe(true);
    expect(actions(await run())).toEqual([]); // Stable.

    // The originals' meaning survives the round trip.
    const api = parseMarkdown(await read('.cursor/rules/api.mdc')).frontmatter?.data;
    expect(api).toEqual({
      description: 'API route conventions',
      globs: 'src/api/**/*.ts',
      alwaysApply: false,
    });
    const claude = await read('CLAUDE.md');
    for (const text of [
      'A small API.',
      '## Commands',
      '- Build with `pnpm build`.',
      '- Prefer named exports.',
    ]) {
      expect(claude).toContain(text);
    }
    expect(await read('.claude/rules/imported-packages-web-claude.md')).toContain(
      'paths:\n  - "packages/web/**"',
    );
    await expect(read('CLAUDE.local.md')).resolves.toBe('Personal notes.\n');

    expect(imported.imported?.notes).toContain(
      "packages/web/CLAUDE.md was imported as a rule scoped to packages/web/**. Delete it once you've checked the generated files, or agents will read both.",
    );

    // Importing again finds nothing new: everything is generated or already a source rule.
    const again = await init(await createContext({ root: dir }), { import: true });
    expect(again.imported?.rules).toEqual([]);
    expect(again.imported?.skipped).toContainEqual({
      path: 'packages/web/CLAUDE.md',
      reason: 'content is already in a source rule',
    });
  });

  it('init without --import refuses to run twice', async () => {
    await init(await createContext({ root: dir }));
    await expect(init(await createContext({ root: dir }))).rejects.toThrow(/already set up/);
  });
});
