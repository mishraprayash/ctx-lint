import { binStatus } from '../../manifests/index.js';
import type { LintRule } from '../rule.js';

const RUNNER: Record<string, string> = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' };

export const binExists: LintRule = {
  id: 'bin-exists',
  meta: {
    description:
      'Executables run with `npx`, `pnpm exec` or `bunx` are installed or provided by a declared dependency.',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'bin') return;
    // `unknown` (node_modules not installed and no matching dependency): don't guess.
    if (binStatus(ctx.manifests.npm, ctx.project.files, ctx.fileDir, ref.name) !== 'missing')
      return;
    ctx.report({
      message: `"${RUNNER[ref.tool] ?? ref.tool} ${ref.name}": "${ref.name}" is not installed and no dependency provides it.`,
      range: ref.range,
    });
  },
};
