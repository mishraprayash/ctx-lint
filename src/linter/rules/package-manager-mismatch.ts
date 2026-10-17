import type { LintRule } from '../rule.js';

export const packageManagerMismatch: LintRule = {
  id: 'package-manager-mismatch',
  meta: {
    description:
      'Commands use the package manager the repo uses (from `packageManager` or the lockfile).',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'script' || ref.tool === 'node') return;
    const pm = ctx.manifests.npm.packageManager;
    if (!pm || pm.name === ref.tool) return;
    ctx.report({
      message: `This repo uses ${pm.name} (${pm.source}), but this command uses ${ref.tool}.`,
      range: ref.range,
      downgrade: true,
    });
  },
};
