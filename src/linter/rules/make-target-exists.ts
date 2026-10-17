import { joinRel } from '../../core/paths.js';
import { hasTarget } from '../../manifests/index.js';
import type { LintRule } from '../rule.js';
import { closest, orList, preview } from '../suggest.js';

export const makeTargetExists: LintRule = {
  id: 'make-target-exists',
  meta: {
    description:
      'Make targets and just recipes exist in the Makefile/justfile that would run them.',
    defaultSeverity: 'error',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'target') return;
    const files = ctx.project.files;
    let dir = ctx.fileDir;
    if (ref.dir !== undefined) {
      const fromFile = joinRel(ctx.fileDir, ref.dir);
      dir = files.isDirectory(fromFile) ? fromFile : joinRel(ref.dir);
    }

    const set = ctx.manifests.targets(ref.tool, dir, ref.file);
    const kind = ref.tool === 'make' ? 'Make target' : 'just recipe';
    if (!set) {
      const what = ref.file ?? (ref.tool === 'make' ? 'Makefile' : 'justfile');
      ctx.report({
        message: `No ${what} found for "${ref.tool} ${ref.name}"${dir === '' ? '' : ` (in ${dir} or above)`}.`,
        range: ref.range,
      });
      return;
    }
    if (hasTarget(set, ref.name)) return;

    const available = [...set.names].sort();
    const near = closest(ref.name, available);
    const parts = [`${kind} "${ref.name}" not found in ${set.file}.`];
    if (near.length > 0) parts.push(`Did you mean ${orList(near)}?`);
    if (available.length > 0) parts.push(`Available: ${preview(available)}.`);
    // Computed target names ($(BIN): …) might produce it.
    ctx.report({ message: parts.join(' '), range: ref.range, downgrade: set.dynamic });
  },
};
