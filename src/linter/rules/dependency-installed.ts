import type { LintRule } from '../rule.js';

export const dependencyInstalled: LintRule = {
  id: 'dependency-installed',
  meta: {
    description: 'Libraries the instructions tell agents to use are declared in some package.json.',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'package' || ref.negated) return; // "instead of `moment`" needn't be installed.
    const { packages } = ctx.manifests.npm;
    if (packages.length === 0) return; // Not a JavaScript project.
    const declared = packages.some((p) => p.dependencies.has(ref.name) || p.name === ref.name);
    if (declared) return;
    ctx.report({
      message: `"${ref.name}" is referenced as a library but isn't in any package.json.`,
      range: ref.range,
    });
  },
};
