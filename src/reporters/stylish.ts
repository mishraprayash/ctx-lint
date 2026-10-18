import type { Diagnostic } from '../core/types.js';
import type { Reporter } from './types.js';

/**
 * The default, human output. One block per problem:
 *
 *   CLAUDE.md:7:24  error  path-exists
 *     Path "src/auth/guards/" does not exist.
 *        7 │ - Auth guards live in `src/auth/guards/`.
 *          │                       ^^^^^^^^^^^^^^^^
 *     → Did you mean "src/auth/guard.ts"?
 *
 * `file:line:col` comes first so terminals and editors make it a link. The summary says what
 * to run next: `--fix` for what can be fixed safely, `--format agent` for the rest.
 */
export const stylish: Reporter = (result, { colors: c }) => {
  const checked = result.files.length;
  const total = result.errorCount + result.warningCount;
  if (total === 0) {
    return `${c.green('✔')} No problems found (${checked} file${checked === 1 ? '' : 's'} checked).\n`;
  }

  const out: string[] = [];
  for (const file of result.files) {
    const lines = file.source.split('\n');
    for (const d of file.diagnostics) {
      const { line, column } = d.range.start;
      const severity = d.severity === 'error' ? c.red('error') : c.yellow('warning');
      out.push(`${c.bold(`${file.path}:${line}:${column}`)}  ${severity}  ${c.dim(d.ruleId)}`);
      const { message, hint } = splitHint(d);
      out.push(`  ${message}`);
      const text = lines[line - 1];
      if (text !== undefined) out.push(...excerpt(text, d, c.dim, c.red));
      if (hint !== null) {
        const fixable = d.suggestion?.replacement !== undefined ? c.green('  (fixable)') : '';
        out.push(`  ${c.cyan('→')} ${hint}${fixable}`);
      }
      out.push('');
    }
  }

  const files = result.files.filter((f) => f.diagnostics.length > 0).length;
  const summary = `✖ ${plural(total, 'problem')} (${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')}) in ${plural(files, 'file')}`;
  out.push(result.errorCount > 0 ? c.red(c.bold(summary)) : c.yellow(c.bold(summary)));

  if (total > 10) {
    const byRule = new Map<string, number>();
    for (const d of result.files.flatMap((f) => f.diagnostics)) {
      byRule.set(d.ruleId, (byRule.get(d.ruleId) ?? 0) + 1);
    }
    const ranked = [...byRule].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push(c.dim(`  By rule: ${ranked.map(([id, n]) => `${id} ${n}`).join(' · ')}`));
  }

  const rest = total - result.fixableCount;
  if (result.fixableCount > 0) {
    out.push(
      `  ${plural(result.fixableCount, 'problem')} can be fixed safely: ctx-lint check --fix`,
    );
  }
  if (rest > 0) {
    out.push(
      c.dim(
        `  ${result.fixableCount > 0 ? 'For the rest' : 'To fix them'}, hand a task to your coding agent: ctx-lint check --fix --format agent`,
      ),
    );
  }
  return `${out.join('\n')}\n`;
};

/** The message without its "Did you mean …?" tail, which is shown on its own line. */
function splitHint(d: Diagnostic): { message: string; hint: string | null } {
  const hint = d.suggestion?.message;
  if (!hint) return { message: d.message, hint: null };
  const message = d.message.endsWith(` ${hint}`)
    ? d.message.slice(0, d.message.length - hint.length - 1)
    : d.message;
  return { message, hint };
}

/** The offending line, with the problem underlined. Tabs become spaces so the marker lines up. */
function excerpt(
  text: string,
  d: Diagnostic,
  dim: (s: string) => string,
  mark: (s: string) => string,
): string[] {
  const { start, end } = d.range;
  const clean = text.replace(/\r$/, '').replaceAll('\t', ' ');
  const from = Math.min(start.column - 1, clean.length);
  const to = end.line === start.line ? Math.min(end.column - 1, clean.length) : clean.length;
  const gutter = String(start.line).padStart(5);
  const shown = clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
  const lines = [`${dim(`${gutter} │`)} ${shown}`];
  if (from < 160) {
    const width = Math.max(1, Math.min(to, 160) - from);
    lines.push(
      `${dim(`${' '.repeat(gutter.length)} │`)} ${' '.repeat(from)}${mark('^'.repeat(width))}`,
    );
  }
  return lines;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
