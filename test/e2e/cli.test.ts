import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const demo = fileURLToPath(new URL('../../examples/demo', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe('built cli', () => {
  beforeAll(() => {
    if (!existsSync(cli)) {
      throw new Error('dist/cli.js not found. Run `pnpm build` first (or use `pnpm test:e2e`).');
    }
  });

  it('runs --help with exit code 0', async () => {
    const result = await execa('node', [cli, '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: ctx-lint');
  });

  it('exits 2 on usage errors', async () => {
    const result = await execa('node', [cli, 'nope'], { reject: false });
    expect(result.exitCode).toBe(2);
    const badRule = await execa('node', [cli, 'check', '--rule', 'nope=error'], { reject: false });
    expect(badRule.exitCode).toBe(2);
    expect(badRule.stderr).toContain('Unknown rule "nope"');
  });

  // examples/demo/expected-output.txt is the documented output; this keeps the demo honest.
  it('prints the documented report for the demo and exits 1', async () => {
    const result = await execa('node', [cli, '--no-color', '--cwd', demo, 'check'], {
      reject: false,
    });
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}\n`).toBe(readFileSync(`${demo}/expected-output.txt`, 'utf8'));
  });

  it('exits 0 when there are only warnings, and 1 with --max-warnings', async () => {
    const args = [
      cli,
      '--no-color',
      '--cwd',
      demo,
      'check',
      '--rule',
      'path-exists=warn',
      '--rule',
      'script-exists=off',
      '--rule',
      'make-target-exists=off',
    ];
    expect((await execa('node', args, { reject: false })).exitCode).toBe(0);
    const strict = await execa('node', [...args, '--max-warnings', '0'], { reject: false });
    expect(strict.exitCode).toBe(1);
    expect(strict.stderr).toContain('too many warnings');
  });

  it('exits 0 for the false-positives fixture', async () => {
    const result = await execa(
      'node',
      [cli, '--no-color', '--cwd', fixture('false-positives'), 'check'],
      {
        reject: false,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No problems found');
  });

  it('sync: conflict exits 1, --force writes, --check passes, then fails after an edit', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-e2e-'));
    try {
      await cp(demo, dir, { recursive: true });
      const sync = (...args: string[]) =>
        execa('node', [cli, '--no-color', '--cwd', dir, 'sync', ...args], { reject: false });

      const conflict = await sync();
      expect(conflict.exitCode).toBe(1);
      expect(conflict.stderr).toContain('CLAUDE.md: exists and has no ctx-lint markers');

      const forced = await sync('--force');
      expect(forced.exitCode).toBe(0);
      expect(forced.stdout).toContain('✔ 7 created, 1 updated, 0 deleted, 0 unchanged');
      expect((await sync('--check')).exitCode).toBe(0);

      await cp(path.join(dir, 'AGENTS.md'), path.join(dir, 'CLAUDE.md'));
      const drift = await sync('--check');
      expect(drift.exitCode).toBe(1);
      expect(drift.stdout).toContain('out of date');

      expect((await sync('--target', 'nope')).exitCode).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
