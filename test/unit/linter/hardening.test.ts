import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';
import { run } from '../../../src/cli/program.js';
import { FileIndex } from '../../../src/fs/file-index.js';

let dir: string;

async function repo(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-hardening-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
  return dir;
}

async function messages(root: string): Promise<string[]> {
  const result = await check(await createContext({ root }));
  return result.files.flatMap((f) =>
    f.diagnostics.map((d) => `${f.path}:${d.range.start.line} ${d.ruleId}: ${d.message}`),
  );
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('tsconfig paths and module-style paths', () => {
  it('resolves aliases from tsconfig (with comments and extends) and extensionless imports', async () => {
    const root = await repo({
      'tsconfig.base.json':
        '{ "compilerOptions": { "baseUrl": ".", "paths": { "~lib/*": ["lib/*"], "*": ["src/*"] } } }',
      'tsconfig.json':
        '{\n  // app config\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}',
      'src/components/Button.tsx': '',
      'src/hooks/index.ts': '',
      'lib/math.ts': '',
      'CLAUDE.md': [
        '- Buttons: `@/components/Button` and `@/hooks`.',
        '- Math: `~lib/math`.',
        '- Missing: `@/components/Card`.',
        '- Modules: `src/components/Button`.',
        '- Timers: `setTimeout`.',
      ].join('\n'),
    });
    const ctx = await createContext({ root });
    expect(ctx.aliases).toEqual({ '~lib/': 'lib/', '@/': 'src/' });
    expect(await messages(root)).toEqual([
      'CLAUDE.md:3 path-exists: Path "@/components/Card" does not exist.',
    ]);
  });
});

describe('plain-word tsconfig aliases', () => {
  it('also resolve the path as written (a real lib/ next to the file)', async () => {
    const root = await repo({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "lib/*": ["./frontend/lib/*"] } } }',
      'frontend/lib/api.ts': '',
      'products/web/lib/github.ts': '',
      'products/web/AGENTS.md': '- `lib/github.ts`, `lib/api.ts` and `lib/gone.ts`.\n',
    });
    expect(await messages(root)).toEqual([
      'products/web/AGENTS.md:1 path-exists: Path "lib/gone.ts" does not exist.',
    ]);
  });
});

describe('git rename detection', () => {
  it('says where a file or directory was renamed, and the fix is applied', async () => {
    const root = await repo({ 'src/auth/guard.ts': '', 'lib/util.ts': '', 'lib/math.ts': '' });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    await mkdir(path.join(root, 'src/security'));
    git('mv', 'src/auth/guard.ts', 'src/security/guard.ts');
    git('mv', 'lib', 'packages');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'move');
    await writeFile(
      path.join(root, 'CLAUDE.md'),
      '- `src/auth/guard.ts`\n- `lib/` holds helpers.\n',
    );

    const found = await messages(root);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(
      /^CLAUDE\.md:1 path-exists: Path "src\/auth\/guard\.ts" does not exist\. It was renamed to "src\/security\/guard\.ts" in [0-9a-f]{7,}\.$/,
    );
    expect(found[1]).toMatch(/Path "lib\/" does not exist\. It was renamed to "packages" in /);

    const fixed = await check(await createContext({ root }), { fix: true });
    expect(fixed.fixed.problems).toBe(2);
  });

  it('does nothing outside a git repository', async () => {
    const root = await repo({ 'CLAUDE.md': '- `src/gone.ts`\n' });
    expect(await messages(root)).toEqual([
      'CLAUDE.md:1 path-exists: Path "src/gone.ts" does not exist.',
    ]);
  });
});

describe('commands run from the root', () => {
  it('follows a "from the root" comment above a command in a nested file', async () => {
    const root = await repo({
      'package.json': '{ "scripts": { "dev:kb": "x" } }',
      'apps/kb/package.json': '{ "scripts": { "build": "x" } }',
      'apps/kb/AGENTS.md':
        '```bash\n# From the root directory of the project\npnpm dev:kb\n\npnpm dev:kb\n```\n',
    });
    const found = await messages(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^apps\/kb\/AGENTS\.md:5 script-exists: /);
  });
});

describe('Cursor frontmatter', () => {
  it('accepts the unquoted globs Cursor writes, and still reports broken YAML', async () => {
    const root = await repo({
      'src/a.ts': '',
      '.cursor/rules/ts.mdc':
        '---\ndescription: TS rules.  Focuses on: types\nglobs: *.ts, src/\nalwaysApply: false\n---\nUse types.\n',
      '.cursor/rules/bad.mdc': '---\nglobs:\n  - *.ts\n   bad: x\n---\nBody.\n',
    });
    const found = await messages(root);
    expect(found.filter((m) => m.startsWith('.cursor/rules/ts.mdc'))).toEqual([]);
    expect(
      found.some((m) => m.startsWith('.cursor/rules/bad.mdc:') && m.includes('frontmatter-valid')),
    ).toBe(true);
  });
});

describe('symlinked instruction files', () => {
  it.skipIf(process.platform === 'win32')('reports problems once, on the real file', async () => {
    const root = await repo({ 'AGENTS.md': '- `src/gone.ts`\n' });
    await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
    expect(await messages(root)).toEqual([
      'AGENTS.md:1 path-exists: Path "src/gone.ts" does not exist.',
    ]);
  });
});

describe('source rules', () => {
  it('resolve relative paths and links from the repo root, where they are compiled to', async () => {
    const root = await repo({
      'PLAN.md': '# Plan\n',
      'docs/guide.md': '',
      '.context/rules/general.md':
        '---\nalwaysApply: true\n---\n\nSee [the plan](PLAN.md), `./docs/guide.md` and [missing](docs/nope.md).\n',
    });
    expect(await messages(root)).toEqual([
      '.context/rules/general.md:5 path-exists: Path "docs/nope.md" does not exist.',
    ]);
  });
});

describe('dependency-installed in mixed and non-npm repos', () => {
  it('counts Python dependencies and skips files that belong to another ecosystem', async () => {
    const root = await repo({
      'package.json': '{ "dependencies": { "zod": "^4" } }',
      'agent/pyproject.toml': [
        '[project]',
        'name = "app"',
        'dependencies = [',
        '  "httpx>=0.27",  # HTTP client',
        '  "pydantic[email]~=2.0",',
        ']',
        '',
        '[dependency-groups]',
        'dev = ["pytest"]',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.12"',
        'Typing_Extensions = "*"',
      ].join('\n'),
      'agent/requirements-dev.txt': '# tools\n-r requirements.txt\nruff==0.6\n',
      'CLAUDE.md': [
        '- Validate with `zod`; install `httpx`, `pydantic`, `pytest`, `ruff`, `typing-extensions`.',
        '- Install `left-pad`.',
      ].join('\n'),
      'crates/core/Cargo.toml': '[package]\nname = "core"\n',
      'crates/core/AGENTS.md': '- Install `serde`.\n',
      'agent/AGENTS.md': '- Install `requests`.\n',
      '.claude/skills/react/SKILL.md': '- Install `swr`.\n',
      'skills/react/AGENTS.md': '- Install `swr`.\n',
    });
    expect(await messages(root)).toEqual([
      'CLAUDE.md:2 dependency-installed: "left-pad" is referenced as a library but isn\'t in any package.json.',
    ]);
  });
});

describe('FileIndex.hasMatch', () => {
  const index = FileIndex.fromPaths('/r', [
    'src/api/users.ts',
    'src/web/App.tsx',
    'docs/a.md',
    'packages/ui/',
  ]);

  it.each([
    ['src/api/**/*.ts', true],
    ['src/**/*.tsx', true],
    ['**/*.md', true],
    ['packages/*', true],
    ['src/api/**/*.vue', false],
    ['nope/**', false],
  ])('%s → %s', (glob, expected) => {
    expect(index.hasMatch(glob)).toBe(expected);
  });
});

describe('ctx-lint explain', () => {
  const capture = () => {
    const io = {
      out: '',
      err: '',
      stdout: (t: string) => {
        io.out += t;
      },
      stderr: (t: string) => {
        io.err += t;
      },
    };
    return io;
  };

  it('lists rules and prints a rule page', async () => {
    const list = capture();
    expect(await run(['node', 'ctx-lint', '--no-color', 'explain'], list)).toBe(0);
    expect(list.out).toContain('path-exists');
    expect(list.out).toContain('generated-file-modified');

    const page = capture();
    expect(await run(['node', 'ctx-lint', '--no-color', 'explain', 'path-case'], page)).toBe(0);
    expect(page.out).toContain('**Default:** error');
    expect(page.out).toContain('docs/rules/path-case.md');
  });

  it('suggests a rule for typos', async () => {
    const io = capture();
    expect(await run(['node', 'ctx-lint', 'explain', 'path-exist'], io)).toBe(2);
    expect(io.err).toContain('Did you mean "path-exists"?');
  });
});
