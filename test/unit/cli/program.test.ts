import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CliIO, run } from '../../../src/cli/program.js';
import { ExitCode } from '../../../src/core/exit-codes.js';
import { VERSION } from '../../../src/core/version.js';

function capture(): CliIO & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
  };
  return io;
}

const argv = (...args: string[]) => ['node', 'ctx-lint', ...args];

describe('cli program', () => {
  it('lists every subcommand in --help', async () => {
    const io = capture();
    expect(await run(argv('--help'), io)).toBe(ExitCode.Success);
    for (const name of ['check', 'sync', 'audit', 'init']) {
      expect(io.out).toMatch(new RegExp(`^\\s+${name}\\b`, 'm'));
    }
  });

  it('prints the package version', async () => {
    const io = capture();
    expect(await run(argv('--version'), io)).toBe(ExitCode.Success);
    expect(io.out.trim()).toBe(VERSION);
  });

  it('exits with Fatal on an unknown command', async () => {
    const io = capture();
    expect(await run(argv('nope'), io)).toBe(ExitCode.Fatal);
    expect(io.err).toContain('unknown command');
  });

  it('exits with Fatal on an invalid option value', async () => {
    const io = capture();
    expect(await run(argv('check', '--max-warnings', '-1'), io)).toBe(ExitCode.Fatal);
    expect(io.err).toContain('non-negative integer');
  });

  it('`check --list-files --format json` lists discovered files', async () => {
    const io = capture();
    const fixture = fileURLToPath(new URL('../../fixtures/discovery', import.meta.url));
    const code = await run(argv('--cwd', fixture, 'check', '--list-files', '--format', 'json'), io);
    expect(code).toBe(ExitCode.Success);
    const output = JSON.parse(io.out) as { files: { path: string; alwaysOn: boolean }[] };
    expect(output.files).toContainEqual(
      expect.objectContaining({ path: 'CLAUDE.md', agents: ['claude'], alwaysOn: true }),
    );
  });

  it('exits with Fatal when an explicit file does not exist', async () => {
    const io = capture();
    expect(await run(argv('check', '--list-files', 'definitely-missing.md'), io)).toBe(
      ExitCode.Fatal,
    );
    expect(io.err).toContain('No such file');
  });

  it.each(['check', 'sync', 'audit', 'init'])(
    '`%s` reports it is not implemented yet',
    async (cmd) => {
      const io = capture();
      expect(await run(argv(cmd), io)).toBe(ExitCode.Fatal);
      expect(io.err).toContain('not implemented yet');
    },
  );
});
