import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

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
  });
});
