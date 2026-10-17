import { joinRel } from '../../core/paths.js';
import { ecosystemOf, normalizePythonName } from '../../manifests/index.js';
import type { LintRule } from '../rule.js';

export const dependencyInstalled: LintRule = {
  id: 'dependency-installed',
  meta: {
    description: 'Libraries the instructions tell agents to use are declared in some package.json.',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'package' || ref.negated) return; // "instead of `moment`" needn't be installed.
    // Agent skills (`.claude/skills/x/`, `skills/x/`) are portable advice about libraries in
    // general, not about this repo's dependencies.
    if (/(?:^|\/)skills?\//.test(ctx.file.path)) return;
    const { packages } = ctx.manifests.npm;
    if (packages.length === 0) return; // Not a JavaScript project.
    // "`ui` may import `shared`": a workspace package by its short name (`@posthog/shared`).
    const declared = packages.some(
      (p) =>
        p.dependencies.has(ref.name) || p.name === ref.name || p.name?.endsWith(`/${ref.name}`),
    );
    if (declared) return;
    // Mixed repos: `httpx` in the Python half is declared in pyproject.toml, not package.json.
    if (!ref.name.startsWith('@') && ctx.manifests.python.has(normalizePythonName(ref.name)))
      return;
    // "Use `templates` for starter projects": a directory or file of that name, not a library.
    const { files } = ctx.project;
    if (files.exists(ref.name) || files.exists(joinRel(ctx.fileDir, ref.name))) return;
    // An instruction file next to a pyproject.toml or Cargo.toml talks about that ecosystem.
    if (ecosystemOf(files, ctx.fileDir) === 'other') return;
    ctx.report({
      message: `"${ref.name}" is referenced as a library but isn't in any package.json.`,
      range: ref.range,
    });
  },
};
