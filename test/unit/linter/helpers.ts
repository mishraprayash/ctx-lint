import { fileURLToPath } from 'node:url';
import { type CheckOptions, check } from '../../../src/api/check.js';
import { createContext } from '../../../src/api/context.js';

export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));

export const demoPath = fileURLToPath(new URL('../../../examples/demo', import.meta.url));

/** Runs `check` on a directory and returns `file:line:col severity rule` lines. */
export async function lint(root: string, options: CheckOptions = {}): Promise<string[]> {
  const ctx = await createContext({ root });
  const result = await check(ctx, options);
  return result.files.flatMap((file) =>
    file.diagnostics.map(
      (d) => `${file.path}:${d.range.start.line}:${d.range.start.column} ${d.severity} ${d.ruleId}`,
    ),
  );
}
