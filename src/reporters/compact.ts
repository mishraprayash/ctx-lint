import type { Reporter } from './types.js';

/** One line per problem: `file:line:col: severity - message (rule)`. Easy to grep. */
export const compact: Reporter = (result) => {
  const lines: string[] = [];
  for (const file of result.files) {
    for (const d of file.diagnostics) {
      const severity = d.severity === 'error' ? 'error' : 'warning';
      lines.push(
        `${file.path}:${d.range.start.line}:${d.range.start.column}: ${severity} - ${d.message} (${d.ruleId})`,
      );
    }
  }
  const total = result.errorCount + result.warningCount;
  lines.push(`${total} problem${total === 1 ? '' : 's'}`);
  return `${lines.join('\n')}\n`;
};
