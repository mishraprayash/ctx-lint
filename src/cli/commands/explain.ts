import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { UsageError } from '../../core/errors.js';
import type { Colors } from '../../core/logger.js';
import { ruleDocsUrl } from '../../core/meta.js';
import { getRule, RULES } from '../../linter/rules/index.js';
import { closest, orList } from '../../linter/suggest.js';
import { globalOptions, loggerFor } from '../global-options.js';
import type { CommandRuntime } from '../io.js';

/**
 * Rule docs ship with the package (`docs/rules`, see `files` in package.json). From the
 * bundle in `dist/` and from `src/cli/commands/` alike, they're found by walking up.
 */
const DOC_DIRS = ['../docs/rules/', '../../../docs/rules/'];

export function explainCommand(runtime: CommandRuntime): Command {
  return new Command('explain')
    .description('Show what a rule checks and how to fix its problems (no argument: list rules)')
    .argument('[rule]', 'rule id, e.g. path-exists')
    .action(async (ruleId: string | undefined, _options: unknown, command: Command) => {
      const c = loggerFor(globalOptions(command), runtime).colors;
      if (ruleId === undefined) {
        runtime.stdout(listRules(c));
        return;
      }
      const rule = getRule(ruleId);
      if (!rule) {
        const near = closest(
          ruleId,
          RULES.map((r) => r.id),
        );
        throw new UsageError(
          `Unknown rule "${ruleId}".${near.length > 0 ? ` Did you mean ${orList(near)}?` : ''} Run \`ctx-lint explain\` to list rules.`,
        );
      }
      const doc = await readDoc(rule.id);
      runtime.stdout(doc ? renderMarkdown(doc, c) : `${rule.id}: ${rule.meta.description}\n`);
      runtime.stdout(`\n${c.dim(ruleDocsUrl(rule.id))}\n`);
    });
}

async function readDoc(id: string): Promise<string | null> {
  for (const dir of DOC_DIRS) {
    try {
      return await readFile(new URL(`${dir}${id}.md`, import.meta.url), 'utf8');
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function listRules(c: Colors): string {
  const width = Math.max(...RULES.map((r) => r.id.length));
  const lines = RULES.map((r) => {
    const severity = r.meta.defaultSeverity === 'error' ? c.red('error') : c.yellow('warn ');
    return `  ${r.id.padEnd(width)}  ${severity}  ${r.meta.description}`;
  });
  return `${lines.join('\n')}\n\n${c.dim('ctx-lint explain <rule> for details.')}\n`;
}

/** Light terminal rendering: bold headings, dim code fences. Everything else as written. */
function renderMarkdown(text: string, c: Colors): string {
  let inFence = false;
  return `${text
    .trimEnd()
    .split('\n')
    .map((line) => {
      if (/^(```|~~~)/.test(line)) {
        inFence = !inFence;
        return c.dim(line);
      }
      if (inFence) return c.cyan(line);
      if (/^#{1,6}\s/.test(line)) return c.bold(line.replace(/^#+\s/, ''));
      return line;
    })
    .join('\n')}\n`;
}
