import { basenameRel, joinRel } from '../core/paths.js';
import type { AgentId } from '../core/types.js';
import type { RuleIR } from '../syncer/ir.js';
import type { OutputFile } from './adapter.js';
import { composeDocument, groupByDirectory, nestedSection, partition } from './compose.js';

/** Compiles a single-file markdown target (CLAUDE.md, AGENTS.md) in `sections` or `nested` mode. */
export function compileMarkdownFile(
  target: AgentId,
  rules: readonly RuleIR[],
  output: string,
  mode: 'sections' | 'nested',
): OutputFile[] {
  const kinds = partition(rules);
  const files: OutputFile[] = [];
  let scopedInline = kinds.scoped;

  if (mode === 'nested') {
    const { byDir, rest } = groupByDirectory(kinds.scoped);
    scopedInline = rest;
    const name = basenameRel(output);
    for (const [dir, dirRules] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
      files.push({
        target,
        path: joinRel(dir, name),
        body: dirRules.map((rule) => nestedSection(rule, dir)).join('\n\n'),
        perRule: false,
      });
    }
  }

  files.unshift({
    target,
    path: output,
    body: composeDocument({
      always: kinds.always,
      scoped: scopedInline,
      onDemand: kinds['on-demand'],
    }),
    perRule: false,
  });
  return files;
}
