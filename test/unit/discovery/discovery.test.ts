import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createContext, findProjectRoot } from '../../../src/api/context.js';
import type { ProjectContext } from '../../../src/core/context.js';
import { UsageError } from '../../../src/core/errors.js';
import { discover } from '../../../src/discovery/index.js';

const fixture = fileURLToPath(new URL('../../fixtures/discovery', import.meta.url));

describe('discover', () => {
  let ctx: ProjectContext;

  beforeAll(async () => {
    ctx = await createContext({ root: fixture });
  });

  it('loads the config from .context/config.json (JSONC)', () => {
    expect(ctx.configPath).toBe(path.join(fixture, '.context', 'config.json'));
    expect(ctx.config.check.exclude).toEqual(['packages/legacy/**']);
  });

  it('finds every agent file, source rules and included extras, sorted', async () => {
    const files = await discover(ctx);
    expect(files.map((f) => [f.path, f.kind, f.agents.join(','), f.alwaysOn])).toEqual([
      ['.context/rules/general.md', 'source', '', false],
      ['.cursor/rules/api.mdc', 'instructions', 'cursor', false],
      ['.cursor/rules/general.mdc', 'instructions', 'cursor', true],
      ['.cursorrules', 'instructions', 'cursor', true],
      ['.github/copilot-instructions.md', 'instructions', 'copilot', true],
      ['.github/instructions/tests.instructions.md', 'instructions', 'copilot', false],
      ['.windsurf/rules/style.md', 'instructions', 'windsurf', true],
      ['AGENTS.md', 'instructions', 'agents', true],
      ['CLAUDE.md', 'instructions', 'claude', true],
      ['docs/agents/review.md', 'extra', '', false],
      ['packages/web/CLAUDE.md', 'instructions', 'claude', false],
    ]);
  });

  it('parses each file once and keeps its frontmatter', async () => {
    const files = await discover(ctx);
    const api = files.find((f) => f.path === '.cursor/rules/api.mdc');
    expect(api?.markdown.frontmatter?.data).toMatchObject({ globs: 'src/api/**/*.ts' });
  });

  it('uses explicit files instead of discovery, bypassing exclude', async () => {
    const files = await discover(ctx, {
      files: ['packages/legacy/CLAUDE.md', './CLAUDE.md'],
      cwd: fixture,
    });
    expect(files.map((f) => f.path)).toEqual(['CLAUDE.md', 'packages/legacy/CLAUDE.md']);
  });

  it('rejects explicit files that are missing or outside the root', async () => {
    await expect(discover(ctx, { files: ['nope.md'], cwd: fixture })).rejects.toThrow(UsageError);
    await expect(discover(ctx, { files: ['../../../package.json'], cwd: fixture })).rejects.toThrow(
      /outside the project root/,
    );
  });
});

describe('findProjectRoot', () => {
  it('finds the nearest directory containing .git', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
    expect(findProjectRoot(path.join(fixture, 'src'))).toBe(path.resolve(repoRoot));
  });
});
