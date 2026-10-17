import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderJsonSchema } from '../../../src/config/json-schema.js';
import { defaultConfig, parseConfig } from '../../../src/config/load.js';
import { ConfigError } from '../../../src/core/errors.js';

describe('config', () => {
  it('fills every default from an empty object', () => {
    const config = defaultConfig();
    expect(config.sources).toBe('.context/rules');
    expect(config.mode).toBe('managed-block');
    expect(config.targets.claude).toEqual({
      enabled: true,
      output: 'CLAUDE.md',
      scopedRules: 'rules',
    });
    expect(config.targets.agents.scopedRules).toBe('sections');
    expect(config.targets.windsurf.enabled).toBe(false);
    expect(config.check.minConfidence).toBe('medium');
    expect(config.audit.budget.default).toBe(2500);
  });

  it('fills nested defaults when a section is partially given', () => {
    const config = parseConfig('{ "targets": { "cursor": { "enabled": false } } }', 'c.json');
    expect(config.targets.cursor).toEqual({ enabled: false, outputDir: '.cursor/rules' });
    expect(config.targets.claude.enabled).toBe(true);
  });

  it('accepts comments and trailing commas', () => {
    const config = parseConfig(
      `{
        // budget for Claude
        "audit": { "budget": { "claude": 3000, }, },
      }`,
      'c.json',
    );
    expect(config.audit.budget).toEqual({ default: 2500, claude: 3000 });
  });

  it('reports JSON syntax errors with a position', () => {
    expect(() => parseConfig('{\n  "sources": ', 'c.json')).toThrow(/c\.json:2:\d+/);
  });

  it('rejects unknown keys and wrong types with a JSON path', () => {
    const run = () =>
      parseConfig('{ "targets": { "cursor": { "outputDir": 3 } }, "typo": 1 }', 'c.json');
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/targets\.cursor\.outputDir/);
    expect(run).toThrow(/typo/);
  });

  it('rejects invalid regular expressions in ignorePatterns', () => {
    expect(() => parseConfig('{ "check": { "ignorePatterns": ["("] } }', 'c.json')).toThrow(
      /check\.ignorePatterns\.0: must be a valid regular expression/,
    );
  });

  it('keeps schema/config.schema.json up to date (run `pnpm schema` to fix)', async () => {
    const committed = await readFile(
      new URL('../../../schema/config.schema.json', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(renderJsonSchema());
  });
});
