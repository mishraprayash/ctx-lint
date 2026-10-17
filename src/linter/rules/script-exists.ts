import { joinRel } from '../../core/paths.js';
import type { ScriptReference } from '../../core/references.js';
import {
  binStatus,
  matchWorkspaces,
  type NpmPackage,
  nearestPackage,
} from '../../manifests/index.js';
import type { LintRule, RuleContext } from '../rule.js';
import { closest, orList, preview } from '../suggest.js';

export const scriptExists: LintRule = {
  id: 'script-exists',
  meta: {
    description: 'package.json scripts run with npm, pnpm, yarn, bun or `node --run` exist.',
    defaultSeverity: 'error',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'script' || ref.ifPresent) return;
    const npm = ctx.manifests.npm;
    const command = commandLabel(ref);

    if (npm.packages.length === 0) {
      ctx.report({
        message: `"${command}" needs a package.json, but the repo has none.`,
        range: ref.range,
      });
      return;
    }

    const dir = ref.dir !== undefined ? resolveDir(ctx, ref.dir) : ctx.fileDir;
    const defines = (pkg: NpmPackage) => definesScript(ctx, pkg, ref.name);
    const runsAsBin = () =>
      ref.orBin === true && binStatus(npm, ctx.project.files, dir, ref.name) === 'found';

    if (ref.workspace !== undefined) {
      const matched = matchWorkspaces(npm, ref.workspace);
      if (matched === null) return; // A selector we can't evaluate.
      if (matched.length === 0) {
        const names = npm.packages.flatMap((p) => (p.name ? [p.name] : []));
        const near = closest(ref.workspace, names);
        ctx.report({
          message: `No workspace matches "${ref.workspace}".${near.length > 0 ? ` Did you mean ${orList(near)}?` : ''}`,
          range: ref.range,
        });
        return;
      }
      if (matched.some(defines) || runsAsBin()) return;
      reportMissing(ctx, ref, matched);
      return;
    }

    if (ref.recursive) {
      if (npm.packages.some(defines) || runsAsBin()) return;
      ctx.report({
        message: `No package in the repo defines a "${ref.name}" script.`,
        range: ref.range,
      });
      return;
    }

    const pkg = nearestPackage(npm, dir);
    if (!pkg) {
      ctx.report({
        message: `"${command}" runs in ${dir === '' ? 'the repo root' : dir}, but there is no package.json there or above it.`,
        range: ref.range,
      });
      return;
    }
    if (defines(pkg) || runsAsBin()) return;

    // Defined somewhere else (PLAN.md §14 Q2): probably run from the wrong place, so a warning.
    // The root package first: "run it from the root" is the most likely fix.
    const elsewhere = npm.packages
      .filter((p) => p !== pkg && defines(p))
      .sort((a, b) => Number(b.dir === '') - Number(a.dir === ''));
    if (elsewhere.length > 0) {
      const where = preview(
        elsewhere.map((p) => p.path),
        3,
      );
      const first = elsewhere[0] as NpmPackage;
      ctx.report({
        message: `Script "${ref.name}" is not defined in ${pkg.path}, but ${where} ${elsewhere.length === 1 ? 'defines' : 'define'} it. Run it there, e.g. \`${workspaceCommand(ref, first)}\`.`,
        range: ref.range,
        downgrade: true,
      });
      return;
    }
    reportMissing(ctx, ref, [pkg]);
  },
};

function reportMissing(
  ctx: RuleContext,
  ref: ScriptReference,
  packages: readonly NpmPackage[],
): void {
  const available = [...new Set(packages.flatMap((p) => [...p.scripts.keys()]))].sort();
  const near = closest(ref.name, available);
  const where =
    packages.length === 1
      ? (packages[0] as NpmPackage).path
      : preview(
          packages.map((p) => p.path),
          3,
        );
  const parts = [`Script "${ref.name}" is not defined in ${where}.`];
  if (near.length > 0) parts.push(`Did you mean ${orList(near)}?`);
  parts.push(available.length > 0 ? `Available: ${preview(available)}.` : 'It has no scripts.');
  ctx.report({ message: parts.join(' '), range: ref.range });
}

/** Whether the package defines the script, counting npm's built-in fallbacks. */
function definesScript(ctx: RuleContext, pkg: NpmPackage, name: string): boolean {
  if (pkg.scripts.has(name)) return true;
  // `npm start` runs `node server.js` without a start script; `restart` runs stop + start.
  if (name === 'start') return ctx.project.files.isFile(joinRel(pkg.dir, 'server.js'));
  if (name === 'restart') return pkg.scripts.has('start');
  return false;
}

function resolveDir(ctx: RuleContext, dir: string): string {
  const fromFile = joinRel(ctx.fileDir, dir);
  return ctx.project.files.isDirectory(fromFile) ? fromFile : joinRel(dir);
}

function commandLabel(ref: ScriptReference): string {
  return ref.tool === 'node' ? `node --run ${ref.name}` : `${ref.tool} run ${ref.name}`;
}

/** How to run a script in another package with the same tool. */
function workspaceCommand(ref: ScriptReference, pkg: NpmPackage): string {
  if (pkg.dir === '') {
    return ref.tool === 'pnpm' ? `pnpm -w ${ref.name}` : `cd <repo root> && ${commandLabel(ref)}`;
  }
  if (!pkg.name) return `cd ${pkg.dir} && ${commandLabel(ref)}`;
  switch (ref.tool) {
    case 'pnpm':
      return `pnpm --filter ${pkg.name} ${ref.name}`;
    case 'yarn':
      return `yarn workspace ${pkg.name} ${ref.name}`;
    case 'bun':
      return `bun run --filter ${pkg.name} ${ref.name}`;
    default:
      return `npm run ${ref.name} -w ${pkg.name}`;
  }
}
