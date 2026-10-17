import type { ProjectContext } from '../core/context.js';
import { type PlanOptions, planSync, type SyncPlan } from '../syncer/plan.js';
import { applyChanges } from '../syncer/write.js';

export interface SyncOptions extends PlanOptions {
  /** Plan only; never write. `--dry-run` and `--check` both set this. */
  dryRun?: boolean;
}

export interface SyncResult {
  plan: SyncPlan;
  /** True when changes were written. */
  written: boolean;
  /** Something is out of date (any change that isn't `unchanged`). */
  outOfDate: boolean;
}

/**
 * Compiles `.context/rules` into every enabled target: the programmatic `ctx-lint sync`.
 * Nothing is written if there are invalid source rules or conflicts: a sync is all or nothing.
 */
export async function sync(ctx: ProjectContext, options: SyncOptions = {}): Promise<SyncResult> {
  const plan = await planSync(ctx, options);
  const pending = plan.changes.filter((c) => c.action !== 'unchanged');
  const blocked = plan.problems.length > 0 || plan.conflicts.length > 0;
  const write = !blocked && !options.dryRun && pending.length > 0;
  if (write) await applyChanges(ctx.root, pending);
  return { plan, written: write, outOfDate: pending.length > 0 || plan.conflicts.length > 0 };
}
