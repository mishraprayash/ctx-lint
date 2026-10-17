import type { Reporter } from './types.js';

/** ESLint-style output, grouped by file (PLAN.md §5.5). */
export const stylish: Reporter = (result, { colors: c }) => {
  const out: string[] = [];
  for (const file of result.files) {
    if (file.diagnostics.length === 0) continue;
    const rows = file.diagnostics.map((d) => ({
      location: `${d.range.start.line}:${d.range.start.column}`,
      severity: d.severity === 'error' ? 'error' : 'warning',
      message: d.message,
      ruleId: d.ruleId,
    }));
    const locationWidth = Math.max(...rows.map((r) => r.location.length));
    const messageWidth = Math.max(...rows.map((r) => r.message.length));

    out.push(c.underline(file.path));
    for (const row of rows) {
      const severity =
        row.severity === 'error' ? c.red(row.severity.padEnd(7)) : c.yellow(row.severity.padEnd(7));
      out.push(
        `  ${c.dim(row.location.padStart(locationWidth))}  ${severity}  ${row.message.padEnd(messageWidth)}  ${c.dim(row.ruleId)}`,
      );
    }
    out.push('');
  }

  const checked = result.files.length;
  if (result.errorCount + result.warningCount === 0) {
    return `${c.green('✔')} No problems found (${checked} file${checked === 1 ? '' : 's'} checked).\n`;
  }

  const total = result.errorCount + result.warningCount;
  const summary = `✖ ${total} problem${total === 1 ? '' : 's'} (${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')})`;
  out.push(result.errorCount > 0 ? c.red(c.bold(summary)) : c.yellow(c.bold(summary)));
  if (result.fixableCount > 0) {
    out.push(c.dim(`  ${plural(result.fixableCount, 'problem')} fixable with --fix`));
  }
  return `${out.join('\n')}\n`;
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
