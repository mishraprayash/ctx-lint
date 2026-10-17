import type { Reporter } from './types.js';

/**
 * GitHub Actions workflow commands: each problem becomes an annotation on the PR diff.
 * https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions
 */
export const github: Reporter = (result) => {
  const lines: string[] = [];
  for (const file of result.files) {
    for (const d of file.diagnostics) {
      const command = d.severity === 'error' ? 'error' : 'warning';
      const props = [
        `file=${escapeProperty(file.path)}`,
        `line=${d.range.start.line}`,
        `col=${d.range.start.column}`,
        `endLine=${d.range.end.line}`,
        `endColumn=${d.range.end.column}`,
        `title=${escapeProperty(`ctx-lint (${d.ruleId})`)}`,
      ].join(',');
      lines.push(`::${command} ${props}::${escapeData(d.message)}`);
    }
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
