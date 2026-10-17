import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { toAbsolute } from '../core/paths.js';
import type { PlannedChange, SyncAction } from './plan.js';

export type ActionCounts = Record<SyncAction, number>;

export function countActions(changes: readonly PlannedChange[]): ActionCounts {
  const counts: ActionCounts = { create: 0, update: 0, unchanged: 0, delete: 0 };
  for (const change of changes) counts[change.action]++;
  return counts;
}

/** Applies a plan. Each write is atomic (temp file + rename), so a crash never leaves half a file. */
export async function applyChanges(root: string, changes: readonly PlannedChange[]): Promise<void> {
  for (const change of changes) {
    const abs = toAbsolute(root, change.path);
    if (change.action === 'delete') {
      await rm(abs, { force: true });
    } else if (change.action === 'create' || change.action === 'update') {
      await mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.ctx-lint-${process.pid}.tmp`;
      await writeFile(tmp, change.after ?? '');
      await rename(tmp, abs);
    }
  }
}

/** A unified diff of one change, for `--dry-run`. */
export function diffOf(change: PlannedChange): string {
  const from = change.before === null ? '/dev/null' : `a/${change.path}`;
  const to = change.after === null ? '/dev/null' : `b/${change.path}`;
  return createTwoFilesPatch(from, to, change.before ?? '', change.after ?? '', '', '', {
    context: 3,
  })
    .split('\n')
    .slice(1) // Drop the "Index:"/"====" preamble line.
    .filter((line) => !/^={10,}$/.test(line))
    .join('\n');
}
