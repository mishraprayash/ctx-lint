import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES } from '../../../src/linter/rules/index.js';

const docsDir = new URL('../../../docs/rules/', import.meta.url);

// Keeps the rule registry and docs/rules/ in sync (PLAN.md §8.4).
describe('rule registry', () => {
  it('has unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(RULES.map((r) => [r.id, r] as const))(
    '%s has a docs page that states its default',
    (id, rule) => {
      const doc = new URL(`${id}.md`, docsDir);
      expect(existsSync(doc)).toBe(true);
      const text = readFileSync(doc, 'utf8');
      expect(text.startsWith(`# ${id}\n`)).toBe(true);
      expect(text).toContain(`**Default:** ${rule.meta.defaultSeverity}`);
    },
  );

  it('has no docs pages for rules that do not exist', () => {
    const documented = readdirSync(docsDir).map((f) => f.replace(/\.md$/, ''));
    expect(documented.sort()).toEqual(RULES.map((r) => r.id).sort());
  });
});
