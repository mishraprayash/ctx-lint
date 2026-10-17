import { existsSync, readFileSync } from 'node:fs';
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
});
