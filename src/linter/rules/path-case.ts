import { caseMatches, displayPath, resolvePath, rewriteAs } from '../resolve.js';
import type { LintRule } from '../rule.js';
import { orList } from '../suggest.js';
import { sourceText } from './util.js';

export const pathCase: LintRule = {
  id: 'path-case',
  meta: {
    description:
      'Paths match the case on disk. A case mismatch works on macOS and Windows but breaks on Linux (and in CI).',
    defaultSeverity: 'error',
    fixable: true,
  },
  reference(ref, ctx) {
    if (ref.kind !== 'path' || ref.isGlob || ctx.isIgnoredPath(ref.value)) return;
    const files = ctx.project.files;
    if (resolvePath(ref, files, ctx.fileDir).status === 'found') return;

    const repoMatches = caseMatches(ref, files, ctx.fileDir);
    if (repoMatches.length === 0) return;
    const matches = repoMatches.map((p) => displayPath(ref, p, ctx.fileDir));
    const written = sourceText(ctx, ref.range);
    const only = repoMatches.length === 1 ? (repoMatches[0] as string) : undefined;
    const replacement = only ? rewriteAs(ref, written, only, ctx.fileDir, files) : null;

    ctx.report({
      message: `"${written}" differs in case from ${orList(matches)}; this breaks on case-sensitive file systems (Linux, CI).`,
      range: ref.range,
      suggestion: {
        message: `Use ${orList(matches)}.`,
        ...(replacement !== null ? { replacement } : {}),
      },
    });
  },
};
