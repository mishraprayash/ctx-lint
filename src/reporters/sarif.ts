import { pathToFileURL } from 'node:url';
import type { Log, ReportingDescriptor, Result } from 'sarif';
import { REPO_URL, ruleDocsUrl } from '../core/meta.js';
import { RULES } from '../linter/rules/index.js';
import type { Reporter } from './types.js';

/** SARIF 2.1.0, for GitHub code scanning and other SARIF viewers. */
export const sarif: Reporter = (result, { root, version }) => {
  const rules: ReportingDescriptor[] = RULES.map((rule) => ({
    id: rule.id,
    shortDescription: { text: rule.meta.description },
    helpUri: ruleDocsUrl(rule.id),
    defaultConfiguration: { level: rule.meta.defaultSeverity === 'error' ? 'error' : 'warning' },
  }));
  const ruleIndex = new Map(RULES.map((rule, i) => [rule.id, i]));

  const results: Result[] = result.files.flatMap((file) =>
    file.diagnostics.map(
      (d): Result => ({
        ruleId: d.ruleId,
        ...(ruleIndex.has(d.ruleId) ? { ruleIndex: ruleIndex.get(d.ruleId) as number } : {}),
        level: d.severity === 'error' ? 'error' : 'warning',
        message: { text: d.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: encodeURI(file.path), uriBaseId: '%SRCROOT%' },
              region: {
                startLine: d.range.start.line,
                startColumn: d.range.start.column,
                endLine: d.range.end.line,
                endColumn: d.range.end.column,
              },
            },
          },
        ],
      }),
    ),
  );

  const log: Log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'ctx-lint', version, informationUri: REPO_URL, rules } },
        originalUriBaseIds: { '%SRCROOT%': { uri: `${pathToFileURL(root).href}/` } },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
};
