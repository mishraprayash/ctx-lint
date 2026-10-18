import { writeFile } from 'node:fs/promises';
import type { Diagnostic } from '../core/types.js';
import type { LoadedFile } from '../discovery/index.js';
import type { LintResult } from './engine.js';

/** Applies non-overlapping replacements, in order. Returns the new text and what was applied. */
export function applyFixesToText(
  text: string,
  diagnostics: readonly Diagnostic[],
): { text: string; applied: number; fixes: Diagnostic[] } {
  const candidates = diagnostics
    .filter((d) => d.suggestion?.replacement !== undefined)
    .sort((a, b) => a.range.start.offset - b.range.start.offset);

  let out = '';
  let cursor = 0;
  const fixes: Diagnostic[] = [];
  for (const d of candidates) {
    const { start, end } = d.range;
    if (start.offset < cursor) continue; // Overlaps a fix we already applied.
    out += text.slice(cursor, start.offset) + (d.suggestion?.replacement as string);
    cursor = end.offset;
    fixes.push(d);
  }
  return { text: out + text.slice(cursor), applied: fixes.length, fixes };
}

/** A file `--fix` rewrote: its content before, and the problems the edits were meant to fix. */
export interface FixedFile {
  file: LoadedFile;
  fixes: Diagnostic[];
}

/** Writes fixes to disk. Generated files are left alone (edit their source rule instead). */
export async function writeFixes(
  files: readonly LoadedFile[],
  result: LintResult,
): Promise<FixedFile[]> {
  const written: FixedFile[] = [];
  for (const fileResult of result.files) {
    if (fileResult.fixableCount === 0) continue;
    const file = files.find((f) => f.path === fileResult.path);
    if (!file) continue;
    const { text, fixes } = applyFixesToText(file.content, fileResult.diagnostics);
    if (fixes.length === 0) continue;
    await writeFile(file.absPath, text);
    written.push({ file, fixes });
  }
  return written;
}

/**
 * Whether a file's fixes worked: every fixed problem is gone, and nothing new appeared. Problems
 * are compared by rule and message, since fixes shift positions.
 */
export function fixesHeld(
  before: readonly Diagnostic[],
  fixes: readonly Diagnostic[],
  after: readonly Diagnostic[],
): boolean {
  const count = (list: readonly Diagnostic[]) => {
    const counts = new Map<string, number>();
    for (const d of list) {
      const key = `${d.ruleId}\0${d.message}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const was = count(before);
  const fixed = count(fixes);
  for (const [key, n] of count(after)) {
    if (n > (was.get(key) ?? 0) - (fixed.get(key) ?? 0)) return false;
  }
  return true;
}

/** Puts back the original content of files whose fixes didn't hold. */
export async function revertFixes(reverted: readonly FixedFile[]): Promise<void> {
  for (const { file } of reverted) await writeFile(file.absPath, file.content);
}
