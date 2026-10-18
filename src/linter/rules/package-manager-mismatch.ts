import type { ScriptReference } from '../../core/references.js';
import type { Range } from '../../core/types.js';
import type { LintRule } from '../rule.js';

export const packageManagerMismatch: LintRule = {
  id: 'package-manager-mismatch',
  meta: {
    description:
      'Commands use the package manager the repo uses (from `packageManager` or the lockfile).',
    defaultSeverity: 'warn',
    fixable: true,
  },
  reference(ref, ctx) {
    if (ref.kind !== 'script' || ref.tool === 'node') return;
    const pm = ctx.manifests.npm.packageManager;
    if (!pm || pm.name === ref.tool) return;
    // `npm run test:e2e` → `pnpm run test:e2e`: only for the plain `<tool> [run] <script>` form,
    // where rewriting the command can't change anything else.
    const command = plainCommand(ref);
    const replacement = `${pm.name} run ${ref.name}`;
    ctx.report({
      message: `This repo uses ${pm.name} (${pm.source}), but this command uses ${ref.tool}.`,
      range: command ?? ref.range,
      downgrade: true,
      suggestion: {
        message: `Use \`${replacement}\`.`,
        ...(command ? { replacement } : {}),
      },
    });
  },
};

/** The range of `npm run x` / `yarn x` / `npm test` around the script name, if written that way. */
function plainCommand(ref: ScriptReference): Range | null {
  const { raw, locate } = ref.candidate;
  for (let i = raw.indexOf(ref.name); i !== -1; i = raw.indexOf(ref.name, i + 1)) {
    if (locate(i, i + ref.name.length).start.offset !== ref.range.start.offset) continue;
    const after = raw.slice(i + ref.name.length);
    if (after !== '' && !/^\s/.test(after)) return null;
    const head = /(?:^|[\s;&|(])((?:npm|yarn|bun|pnpm)(?:\s+run(?:-script)?)?\s+)$/.exec(
      raw.slice(0, i),
    );
    if (!head || !head[1]?.startsWith(ref.tool)) return null;
    const start = i - head[1].length;
    return locate(start, i + ref.name.length);
  }
  return null;
}
