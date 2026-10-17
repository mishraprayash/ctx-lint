import { describe, expect, it } from 'vitest';
import { configSchema } from '../../../src/config/schema.js';
import { normalizeRel } from '../../../src/core/paths.js';
import { AGENT_IDS } from '../../../src/core/types.js';
import { managedBlock, renderWholeFile } from '../../../src/syncer/generated.js';
import type { RuleIR } from '../../../src/syncer/ir.js';
import type { OutputFile } from '../../../src/targets/adapter.js';
import { getTarget } from '../../../src/targets/registry.js';

const rule = (r: Partial<RuleIR> & Pick<RuleIR, 'id' | 'kind' | 'body'>): RuleIR => ({
  globs: [],
  targets: [...AGENT_IDS],
  priority: 0,
  sourcePath: `.context/rules/${r.id}.md`,
  ...r,
});

/** One rule of every kind, including the tricky bits (a body heading, a `*` glob, a nested id). */
const RULES: RuleIR[] = [
  rule({
    id: 'general',
    kind: 'always',
    description: 'General conventions',
    body: '- Use TypeScript.\n- Run `pnpm test`.',
  }),
  rule({ id: 'style', kind: 'always', body: '# Code style\n\n- Prefer named exports.' }),
  rule({
    id: 'backend/api',
    kind: 'scoped',
    description: 'API routes',
    globs: ['src/api/**/*.ts'],
    body: '- Validate request bodies.',
  }),
  rule({ id: 'tests', kind: 'scoped', globs: ['**/*.test.ts', 'e2e/**'], body: '- Use vitest.' }),
  rule({
    id: 'release',
    kind: 'on-demand',
    description: 'How to cut a release',
    body: '1. Bump the version.\n2. Tag it.',
  }),
];

/** Renders outputs the way `sync` writes them (whole files, or managed blocks for single files). */
function render(outputs: OutputFile[]): string {
  return outputs
    .map((o) => {
      const content = o.perRule
        ? renderWholeFile('.context/rules', o.body, o.frontmatter)
        : o.body.trim() === ''
          ? '(no file)\n'
          : `${managedBlock('.context/rules', o.body)}\n`;
      return `==> ${o.path} <==\n${content}`;
    })
    .join('\n');
}

const cases: [string, Record<string, unknown>][] = [
  ['claude', {}],
  ['claude', { scopedRules: 'sections' }],
  ['claude', { scopedRules: 'nested' }],
  ['agents', {}],
  ['agents', { scopedRules: 'nested' }],
  ['cursor', {}],
  ['copilot', {}],
  ['copilot', { scopedRules: 'sections' }],
  ['windsurf', {}],
];

describe('target compilers', () => {
  it.each(cases)('%s %j', async (id, targetConfig) => {
    const config = configSchema.parse({ targets: { [id]: targetConfig } });
    const target = getTarget(id as (typeof AGENT_IDS)[number]);
    const outputs = target.compile(RULES, { config });
    const name = [id, ...(Object.values(targetConfig) as string[])].join('-');
    await expect(render(outputs)).toMatchFileSnapshot(`./__snapshots__/${name}.txt`);
  });

  it('writes Cursor globs as one comma-separated string, quoting YAML indicators', () => {
    const config = configSchema.parse({});
    const [tests] = getTarget('cursor').compile([RULES[3] as RuleIR], { config });
    expect(tests?.frontmatter).toBe(
      '---\ndescription:\nglobs: "**/*.test.ts, e2e/**"\nalwaysApply: false\n---\n',
    );
  });

  it('warns when a Windsurf rule is over 12,000 characters', () => {
    const config = configSchema.parse({});
    const big = rule({ id: 'big', kind: 'always', body: 'x'.repeat(12_001) });
    const [out] = getTarget('windsurf').compile([big], { config });
    expect(out?.warnings?.[0]).toMatch(/at most 12000/);
  });

  it('puts per-rule files under the configured directories', () => {
    const config = configSchema.parse({ targets: { cursor: { outputDir: 'tools/cursor-rules' } } });
    const paths = getTarget('cursor')
      .compile(RULES, { config })
      .map((o) => normalizeRel(o.path));
    expect(paths).toContain('tools/cursor-rules/backend/api.mdc');
  });
});
