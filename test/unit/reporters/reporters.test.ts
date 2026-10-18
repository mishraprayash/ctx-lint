import { readFileSync } from 'node:fs';
import ajvDraft04 from 'ajv-draft-04';
import { beforeAll, describe, expect, it } from 'vitest';
import { check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';
import { createLogger } from '../../../src/core/logger.js';
import type { LintResult } from '../../../src/linter/engine.js';
import { REPORTERS } from '../../../src/reporters/index.js';
import type { ReportContext } from '../../../src/reporters/types.js';
import { demoPath } from '../linter/helpers.js';

// ajv-draft-04 is CommonJS: under NodeNext the default import is `module.exports`, whose
// `default` property is the class.
const Ajv = ajvDraft04.default;

let result: LintResult;
let ctx: ReportContext;

beforeAll(async () => {
  const project = await createContext({ root: demoPath });
  result = await check(project);
  ctx = { root: project.root, colors: createLogger({ color: false }).colors, version: '1.2.3' };
});

describe('reporters', () => {
  it('stylish shows each problem with a clickable location, the line and the fix', () => {
    const out = REPORTERS.stylish(result, ctx);
    expect(out).toContain(
      [
        'CLAUDE.md:7:24  error  path-exists',
        '  Path "src/auth/guards/" does not exist.',
        '    7 │ - Auth guards live in `src/auth/guards/`.',
        '      │                        ^^^^^^^^^^^^^^^^',
        '  → Did you mean "src/auth/guard.ts"?',
      ].join('\n'),
    );
    expect(out).toContain('  → Use `pnpm run test:e2e`.  (fixable)');
    expect(out).toContain('✖ 7 problems (4 errors, 3 warnings) in 2 files');
    expect(out).toContain('1 problem can be fixed safely: ctx-lint check --fix');
    expect(out).toContain('ctx-lint check --fix --format agent');
  });

  it('agent lists what --fix cannot do, with the line, candidates and strict rules', () => {
    const out = REPORTERS.agent(result, ctx);
    expect(out).toContain('# Fix the agent instruction files flagged by ctx-lint');
    expect(out).toContain('Never invent a path');
    expect(out).toContain('### 2. `CLAUDE.md:7:24` (error, path-exists)');
    expect(out).toContain('7: - Auth guards live in `src/auth/guards/`.');
    expect(out).toContain('Candidates (they exist in this repository): `src/auth/guard.ts`');
    expect(out).toContain('No matching path exists in this repository.');
    // The npm → pnpm rewrite is fixable, so it's left to --fix rather than listed.
    expect(out).not.toContain('package-manager-mismatch');
    expect(out).toContain('ctx-lint check --fix --format agent');
    expect(out).toContain('## Done when');
  });

  it('agent says when there is nothing to do', () => {
    const empty: LintResult = {
      files: [],
      errorCount: 0,
      warningCount: 0,
      fixableCount: 0,
      rules: [],
    };
    expect(REPORTERS.agent(empty, ctx)).toContain('There is nothing to fix.');
  });

  it('stylish says so when there are no problems', () => {
    const empty: LintResult = {
      files: [],
      errorCount: 0,
      warningCount: 0,
      fixableCount: 0,
      rules: [],
    };
    expect(REPORTERS.stylish(empty, ctx)).toBe('✔ No problems found (0 files checked).\n');
  });

  it('json has a versioned, stable shape', () => {
    const report = JSON.parse(REPORTERS.json(result, ctx));
    expect(report).toMatchObject({
      version: 1,
      tool: { name: 'ctx-lint', version: '1.2.3' },
      errorCount: 4,
      warningCount: 3,
    });
    const claude = report.files.find((f: { path: string }) => f.path === 'CLAUDE.md');
    expect(claude.messages[0]).toEqual({
      ruleId: 'path-exists',
      severity: 'error',
      message: 'Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard.ts"?',
      line: 7,
      column: 24,
      endLine: 7,
      endColumn: 40,
      suggestion: {
        message: 'Did you mean "src/auth/guard.ts"?',
        candidates: ['src/auth/guard.ts'],
      },
    });
  });

  it('compact prints one line per problem', () => {
    const lines = REPORTERS.compact(result, ctx).trim().split('\n');
    expect(lines).toHaveLength(8);
    expect(lines[1]).toBe(
      'CLAUDE.md:7:24: error - Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard.ts"? (path-exists)',
    );
  });

  it('github emits escaped workflow commands', () => {
    const lines = REPORTERS.github(result, ctx).trim().split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(
      '::error file=CLAUDE.md,line=7,col=24,endLine=7,endColumn=40,title=ctx-lint (path-exists)::Path "src/auth/guards/" does not exist. Did you mean "src/auth/guard.ts"?',
    );
    const first = result.files.flatMap((f) => f.diagnostics)[0];
    if (!first) throw new Error('expected diagnostics');
    const tricky: LintResult = {
      ...result,
      files: [
        {
          path: 'a,b:c.md',
          source: '',
          errorCount: 1,
          warningCount: 0,
          fixableCount: 0,
          diagnostics: [{ ...first, message: '50%\nnext' }],
        },
      ],
    };
    expect(REPORTERS.github(tricky, ctx)).toContain('file=a%2Cb%3Ac.md');
    expect(REPORTERS.github(tricky, ctx)).toContain('::50%25%0Anext');
  });

  it('sarif validates against the SARIF 2.1.0 schema', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../schemas/sarif-2.1.0-rtm.5.json', import.meta.url), 'utf8'),
    );
    // The official schema uses patterns that aren't valid with the `u` flag.
    const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: false });
    const validate = ajv.compile(schema);
    const log = JSON.parse(REPORTERS.sarif(result, ctx));
    const valid = validate(log);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(log.runs[0].results).toHaveLength(7);
    expect(log.runs[0].results[1]).toMatchObject({
      ruleId: 'path-exists',
      level: 'error',
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'CLAUDE.md' },
            region: { startLine: 7, startColumn: 24 },
          },
        },
      ],
    });
  });
});
