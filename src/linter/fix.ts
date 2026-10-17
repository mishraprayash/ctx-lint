import { writeFile } from 'node:fs/promises';
import type { Diagnostic } from '../core/types.js';
import type { LoadedFile } from '../discovery/index.js';
import type { LintResult } from './engine.js';

/** Applies non-overlapping replacements, in order. Returns the new text and how many applied. */
export function applyFixesToText(
  text: string,
  diagnostics: readonly Diagnostic[],
): { text: string; applied: number } {
  const fixes = diagnostics
    .filter((d) => d.suggestion?.replacement !== undefined)
    .sort((a, b) => a.range.start.offset - b.range.start.offset);

  let out = '';
  let cursor = 0;
  let applied = 0;
  for (const d of fixes) {
    const { start, end } = d.range;
    if (start.offset < cursor) continue; // Overlaps a fix we already applied.
    out += text.slice(cursor, start.offset) + (d.suggestion?.replacement as string);
    cursor = end.offset;
    applied++;
  }
  return { text: out + text.slice(cursor), applied };
}

/** Writes fixes to disk. Generated files are left alone (edit their source rule instead). */
export async function writeFixes(
  files: readonly LoadedFile[],
  result: LintResult,
): Promise<{ files: number; problems: number }> {
  let fileCount = 0;
  let problems = 0;
  for (const fileResult of result.files) {
    if (fileResult.fixableCount === 0) continue;
    const file = files.find((f) => f.path === fileResult.path);
    if (!file) continue;
    const { text, applied } = applyFixesToText(file.content, fileResult.diagnostics);
    if (applied === 0) continue;
    await writeFile(file.absPath, text);
    fileCount++;
    problems += applied;
  }
  return { files: fileCount, problems };
}
