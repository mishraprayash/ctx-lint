import type { Diagnostic } from '../core/types.js';
import type { Reporter } from './types.js';

/**
 * Machine-readable output. The shape is public API (PLAN.md §10): additive changes only,
 * and anything breaking bumps `version`.
 */
export const JSON_FORMAT_VERSION = 1;

export const json: Reporter = (result, { version }) => {
  const report = {
    version: JSON_FORMAT_VERSION,
    tool: { name: 'ctx-lint', version },
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    fixableCount: result.fixableCount,
    files: result.files.map((file) => ({
      path: file.path,
      errorCount: file.errorCount,
      warningCount: file.warningCount,
      fixableCount: file.fixableCount,
      messages: file.diagnostics.map(toMessage),
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
};

export function toMessage(d: Diagnostic) {
  return {
    ruleId: d.ruleId,
    severity: d.severity === 'error' ? 'error' : 'warning',
    message: d.message,
    line: d.range.start.line,
    column: d.range.start.column,
    endLine: d.range.end.line,
    endColumn: d.range.end.column,
    ...(d.suggestion ? { suggestion: d.suggestion } : {}),
  };
}
