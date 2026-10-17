import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { audit } from '../../../src/api/audit.js';
import { createContext } from '../../../src/api/context.js';
import { importSpecs } from '../../../src/auditor/baseline.js';
import { estimateTokens } from '../../../src/auditor/heuristic.js';
import { loadTokenizer } from '../../../src/auditor/tokenizer.js';
import { parseMarkdown } from '../../../src/parsers/markdown.js';
import { demoPath, fixturePath } from '../linter/helpers.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** The repo's own markdown: a corpus that's always available (calibration also uses dependency READMEs). */
function repoMarkdown(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'coverage', '__snapshots__'].includes(entry.name))
          walk(full);
      } else if (/\.(md|mdc)$/.test(entry.name) && statSync(full).size > 400) {
        out.push({ name: path.relative(repoRoot, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(repoRoot);
  return out;
}

describe('heuristic tokenizer', () => {
  it('stays close to o200k on real markdown (docs/audit.md documents the error)', async () => {
    const o200k = await loadTokenizer('o200k');
    const corpus = repoMarkdown();
    expect(corpus.length).toBeGreaterThan(20);
    const errors = corpus.map(({ text }) => {
      const exact = o200k.count(text);
      return Math.abs(estimateTokens(text) - exact) / exact;
    });
    const sorted = [...errors].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    expect(median).toBeLessThan(0.06);
    expect(Math.max(...errors)).toBeLessThan(0.2);
  });

  it('counts empty text as zero and anything else as at least one', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
  });

  it('counts special-token strings instead of rejecting them', async () => {
    const o200k = await loadTokenizer('o200k');
    expect(o200k.count('before <|endoftext|> after')).toBeGreaterThan(3);
  });
});

describe('importSpecs', () => {
  it('finds @path imports in text but not in code, emails or escaped forms', () => {
    const md =
      'See @docs/a.md and @README, or @My\\ Notes.md.\n\n`@not/code.md` and dev@example.com\n\n```\n@not/block.md\n```\n';
    expect(importSpecs(parseMarkdown(md).tree)).toEqual(['docs/a.md', 'README', 'My Notes.md']);
  });
});

describe('audit', () => {
  it('counts what each agent loads, including imports and AGENTS.md', async () => {
    const ctx = await createContext({ root: fixturePath('audit-budget') });
    const result = await audit(ctx, { tokenizer: 'o200k' });
    const byAgent = Object.fromEntries(result.agents.map((a) => [a.agent, a]));

    // Claude: CLAUDE.md plus two levels of @imports; not AGENTS.md (CLAUDE.md exists).
    expect(byAgent.claude?.files.map((f) => `${f.path}${f.via ? ` (${f.via})` : ''}`)).toEqual([
      'CLAUDE.md',
      'docs/conventions.md (import)',
      'docs/style.md (import)',
      '.claude/rules/api.md',
    ]);
    expect(byAgent.claude?.conditional).toBe(
      byAgent.claude?.files.find((f) => !f.alwaysOn)?.tokens,
    );

    // Cursor also loads the root AGENTS.md, which repeats one of its rules.
    expect(
      byAgent.cursor?.files
        .filter((f) => f.alwaysOn)
        .map((f) => f.path)
        .sort(),
    ).toEqual(['.cursor/rules/general.mdc', 'AGENTS.md']);
    expect(byAgent.cursor?.duplicateBlocks).toBe(1);

    expect(result.overBudget).toEqual(['claude']);
    expect(byAgent.claude?.budget).toBe(50);
    expect(result.largeFiles.map((f) => f.path)).toEqual(['CLAUDE.md']);
    expect(result.sections[0]).toMatchObject({ file: 'CLAUDE.md', heading: 'Testing', line: 7 });
    expect(result.projected).toBeNull(); // No source rules.
  });

  it('heuristic per-agent totals are within the documented tolerance of o200k', async () => {
    const ctx = await createContext({ root: fixturePath('audit-budget') });
    const exact = await audit(ctx, { tokenizer: 'o200k' });
    const estimate = await audit(ctx);
    for (const agent of exact.agents) {
      const est = estimate.agents.find((a) => a.agent === agent.agent);
      expect(Math.abs((est?.alwaysOn ?? 0) - agent.alwaysOn) / agent.alwaysOn).toBeLessThan(0.15);
    }
  });

  it('--budget overrides every agent', async () => {
    const ctx = await createContext({ root: fixturePath('audit-budget') });
    const result = await audit(ctx, { budget: 10_000 });
    expect(result.overBudget).toEqual([]);
    expect(result.agents.every((a) => a.budget === 10_000)).toBe(true);
  });

  it('projects the baseline after sync from source rules', async () => {
    const result = await audit(await createContext({ root: demoPath }));
    expect(result.agents.map((a) => a.agent)).toEqual(['claude']);
    expect(result.projected?.map((a) => a.agent)).toEqual([
      'claude',
      'agents',
      'cursor',
      'copilot',
    ]);
    const projectedClaude = result.projected?.find((a) => a.agent === 'claude');
    // The scoped API rule moves to .claude/rules, so it no longer counts as always-on.
    expect(projectedClaude?.files.find((f) => f.path === '.claude/rules/api.md')?.alwaysOn).toBe(
      false,
    );
  });
});
