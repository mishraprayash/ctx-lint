import type { Diagnostic } from '../core/types.js';
import type { FileResult } from '../linter/engine.js';
import type { Reporter } from './types.js';

/**
 * A task for a coding agent: the problems `--fix` can't resolve on its own, each with its line
 * and the real candidates, plus strict rules (never invent a path) and a check that proves the
 * work is done (`ctx-lint check`). `ctx-lint` stays deterministic; the agent does the rewriting.
 */
export const agent: Reporter = (result) => {
  const open = result.files.flatMap((file) =>
    file.diagnostics
      .filter((d) => d.suggestion?.replacement === undefined)
      .map((d) => ({ file, d })),
  );
  const fixable = result.fixableCount;

  if (open.length === 0 && fixable === 0) {
    return 'ctx-lint found no problems in the instruction files. There is nothing to fix.\n';
  }

  const out: string[] = ['# Fix the agent instruction files flagged by ctx-lint', ''];
  if (fixable > 0) {
    out.push(
      `First run \`ctx-lint check --fix --format agent\`: ${fixable} problem${fixable === 1 ? ' has' : 's have'} a safe automatic fix, which it applies and re-checks, and the list below then shows only what is left.`,
      '',
    );
  }
  if (open.length === 0) {
    out.push('Nothing else needs a decision. Run `ctx-lint check` afterwards to confirm.', '');
    return `${out.join('\n')}\n`;
  }

  out.push(
    `ctx-lint checked this repository's AI agent instruction files (CLAUDE.md, AGENTS.md, Cursor, Copilot and similar rules) against the code. ${open.length} problem${open.length === 1 ? ' needs' : 's need'} a decision. Fix them by editing those files only.`,
    '',
    '## Rules',
    '',
    '- Only edit the instruction files listed below. Do not change code, and do not create files, folders or scripts to make a reference valid.',
    '- Never invent a path, script, target or heading. Use one of the candidates listed for a problem, or one you have confirmed exists in this repository.',
    '- If nothing fits, rewrite the sentence so it no longer refers to the missing thing, or remove it if it no longer applies.',
    '- If the reference is correct as written (it points outside this repository, or to something created at run time or by a build), keep it and put `<!-- ctx-lint-disable-next-line <rule> -- <reason> -->` on the line above it.',
    '- Warnings are less certain than errors: if a warning is wrong, use the disable comment instead of changing correct text.',
    '- Change as little as possible and keep each file’s wording and style.',
    '',
    '## Problems',
    '',
  );

  open.forEach(({ file, d }, i) => {
    const { line, column } = d.range.start;
    out.push(
      `### ${i + 1}. \`${file.path}:${line}:${column}\` (${d.severity === 'error' ? 'error' : 'warning'}, ${d.ruleId})`,
      '',
      d.message,
      '',
    );
    const text = sourceLine(file, d);
    if (text !== null) out.push('```md', `${line}: ${text}`, '```', '');
    const candidates = d.suggestion?.candidates ?? [];
    if (candidates.length > 0) {
      out.push(
        `Candidates (they exist in this repository): ${candidates.map((c) => `\`${c}\``).join(', ')}`,
        '',
      );
    } else if (PATH_RULES.has(d.ruleId)) {
      out.push('No matching path exists in this repository.', '');
    }
  });

  out.push(
    '## Done when',
    '',
    'Run `ctx-lint check`. The work is done when it reports none of the problems above. If it reports something new, fix that too, following the same rules.',
  );
  return `${out.join('\n')}\n`;
};

const PATH_RULES: ReadonlySet<string> = new Set(['path-exists', 'glob-matches', 'link-anchor']);

function sourceLine(file: FileResult, d: Diagnostic): string | null {
  const text = file.source.split('\n')[d.range.start.line - 1];
  return text === undefined ? null : text.replace(/\r$/, '').trim();
}
