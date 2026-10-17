import { caseMatches, displayPath, resolvePath, rewriteAs, suggestPath } from '../resolve.js';
import type { LintRule } from '../rule.js';
import { orList } from '../suggest.js';
import { sourceText } from './util.js';

export const pathExists: LintRule = {
  id: 'path-exists',
  meta: {
    description: 'Files and directories referenced in instruction files exist.',
    defaultSeverity: 'error',
    fixable: true,
  },
  reference(ref, ctx) {
    if (ref.kind !== 'path' || ref.isGlob) return;
    const files = ctx.project.files;
    if (ctx.isIgnoredPath(ref.value)) return;

    const resolution = resolvePath(ref, files, ctx.fileDir);
    if (resolution.status === 'found') return;
    if (caseMatches(ref, files, ctx.fileDir).length > 0) return; // Reported by path-case.

    const written = sourceText(ctx, ref.range);
    if (resolution.status === 'not-a-directory') {
      ctx.report({
        message: `"${written}" is a file, not a directory.`,
        range: ref.range,
        suggestion: {
          message: 'Remove the trailing slash.',
          replacement: written.replace(/\/+$/, ''),
        },
      });
      return;
    }

    // Missing but gitignored (`.env.local`, `out/`): a local or generated file, not rot.
    if (resolution.tried.some((p) => files.wouldBeIgnored(p, ref.isDir ? 'dir' : 'file'))) return;

    const suggestion = suggestPath(ref, files, ctx.fileDir, ctx.manifests.renames);
    const shown = suggestion.paths.map((p) => displayPath(ref, p, ctx.fileDir));
    const question = suggestion.renamedIn
      ? `It was renamed to ${orList(shown)} in ${suggestion.renamedIn}.`
      : `Did you mean ${orList(shown)}?`;
    const hint = shown.length > 0 ? ` ${question}` : '';
    const only = suggestion.paths[0];
    const replacement =
      suggestion.fixable && only !== undefined
        ? rewriteAs(ref, written, only, ctx.fileDir, files)
        : null;

    ctx.report({
      message: `Path "${written}" does not exist.${hint}`,
      range: ref.range,
      ...(suggestion.paths.length > 0
        ? {
            suggestion: {
              message: question,
              ...(replacement !== null ? { replacement } : {}),
            },
          }
        : {}),
    });
  },
};
