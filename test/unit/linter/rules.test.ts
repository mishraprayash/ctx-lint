import { describe, expect, it } from 'vitest';
import { check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';
import { demoPath, fixturePath, lint } from './helpers.js';

describe('check: monorepo fixture (every rule)', () => {
  it('reports exactly the planted problems', async () => {
    expect(await lint(fixturePath('monorepo'))).toEqual([
      '.context/rules/orphan.md:2:1 error frontmatter-valid',
      '.cursor/rules/api.mdc:3:1 warn frontmatter-valid', // unknown key "glob"
      '.cursor/rules/api.mdc:4:8 warn glob-matches', // services/** matches nothing
      '.cursor/rules/api.mdc:5:1 error frontmatter-valid', // alwaysApply: "yes"
      'CLAUDE.md:6:33 warn script-exists', // --filter web storybook (bare: could be a bin)
      'CLAUDE.md:7:41 warn script-exists', // --filter mobile: no workspace
      'CLAUDE.md:9:43 error script-exists', // test:units
      'CLAUDE.md:10:14 warn package-manager-mismatch', // npm in a pnpm repo (fixable)
      'CLAUDE.md:15:56 error make-target-exists', // make docs
      'CLAUDE.md:16:51 error make-target-exists', // just publish
      'CLAUDE.md:20:91 warn link-anchor', // #install
      'CLAUDE.md:21:17 error path-case', // docs/Guide.md
      'CLAUDE.md:23:18 error path-exists', // moved to packages/ui
      'CLAUDE.md:29:8 warn dependency-installed', // zod
      'CLAUDE.md:34:1 warn unused-disable',
      'CLAUDE.md:37:1 warn unused-disable', // unknown rule
      'apps/web/CLAUDE.md:2:30 warn script-exists', // defined in the root instead
      'apps/web/CLAUDE.md:3:17 error path-case', // ./src/app.tsx
    ]);
  });

  it('explains problems with suggestions', async () => {
    const ctx = await createContext({ root: fixturePath('monorepo') });
    const result = await check(ctx);
    const messages = result.files.flatMap((f) => f.diagnostics.map((d) => d.message));
    expect(messages).toContain(
      'Path "apps/web/src/Header.tsx" does not exist. Did you mean "packages/ui/src/Header.tsx"?',
    );
    expect(messages).toContain(
      'Script "test:units" is not defined in package.json. Did you mean "test:unit"? Available: build, lint, test:unit.',
    );
    expect(messages).toContain(
      'Unknown frontmatter key "glob" for Cursor rules. Did you mean "globs"?',
    );
    expect(messages.some((m) => m.includes('`pnpm -w build`'))).toBe(true);
    expect(result.fixableCount).toBe(4); // Header.tsx move, two case fixes, npm → pnpm
  });
});

describe('check: options', () => {
  const root = fixturePath('monorepo');

  it('--quiet reports errors only', async () => {
    const lines = await lint(root, { quiet: true });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.includes(' error '))).toBe(true);
  });

  it('--rule overrides severities and turns rules off', async () => {
    const lines = await lint(root, {
      rules: { 'path-case': 'off', 'unused-disable': 'off', 'make-target-exists': 'warn' },
    });
    expect(lines.some((l) => l.includes('path-case'))).toBe(false);
    expect(lines.some((l) => l.includes('unused-disable'))).toBe(false);
    expect(
      lines.filter((l) => l.includes('make-target-exists')).every((l) => l.includes(' warn ')),
    ).toBe(true);
  });

  it('--no-deps skips dependency checks', async () => {
    const lines = await lint(root, { deps: false });
    expect(lines.some((l) => l.includes('dependency-installed'))).toBe(false);
  });

  it('lints only explicit files when given', async () => {
    const lines = await lint(root, { files: ['apps/web/CLAUDE.md'], cwd: root });
    expect(lines.every((l) => l.startsWith('apps/web/CLAUDE.md'))).toBe(true);
    expect(lines).toHaveLength(2);
  });
});

describe('check: demo and false positives', () => {
  it('catches the demo rot', async () => {
    expect(await lint(demoPath)).toEqual([
      '.context/rules/api.md:3:8 warn glob-matches',
      'CLAUDE.md:7:24 error path-exists',
      'CLAUDE.md:9:16 error path-exists',
      'CLAUDE.md:13:34 warn package-manager-mismatch',
      'CLAUDE.md:13:42 error script-exists',
      'CLAUDE.md:15:40 error make-target-exists',
      'CLAUDE.md:24:8 warn dependency-installed',
    ]);
  });

  // The false-positive gate (PLAN.md §8.1).
  it('reports nothing for the false-positives fixture', async () => {
    expect(await lint(fixturePath('false-positives'))).toEqual([]);
  });
});
