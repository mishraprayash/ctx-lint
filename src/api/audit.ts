import { type AgentAudit, type AuditInput, computeBaselines } from '../auditor/baseline.js';
import { type Section, sectionsOf } from '../auditor/sections.js';
import { loadTokenizer, type TokenizerName } from '../auditor/tokenizer.js';
import type { ProjectContext } from '../core/context.js';
import type { AgentId } from '../core/types.js';
import { discover } from '../discovery/index.js';
import { TextCache } from '../fs/text-cache.js';
import { parseMarkdown } from '../parsers/markdown.js';
import { planSync } from '../syncer/plan.js';
import { getTarget, TARGETS } from '../targets/registry.js';

export interface AuditOptions {
  tokenizer?: TokenizerName;
  /** Always-on budget for every agent (overrides `audit.budget`). */
  budget?: number;
}

export interface AuditResult {
  tokenizer: { name: TokenizerName; exact: boolean };
  /** Per agent, from the files on disk. */
  agents: AgentAudit[];
  /** Per agent, after `ctx-lint sync` (`null` without source rules, or when the numbers wouldn't change). */
  projected: AgentAudit[] | null;
  /** Sections of always-on files, largest first. */
  sections: Section[];
  /** Instruction files larger than `audit.fileWarn`. */
  largeFiles: { path: string; tokens: number }[];
  /** Agents whose always-on tokens exceed their budget. */
  overBudget: AgentId[];
}

/** Token cost of the instruction files, per agent: the programmatic `ctx-lint audit`. */
export async function audit(ctx: ProjectContext, options: AuditOptions = {}): Promise<AuditResult> {
  const tokenizer = await loadTokenizer(options.tokenizer ?? ctx.config.audit.tokenizer);
  const text = new TextCache(ctx.root);
  const enabled =
    ctx.configPath !== null
      ? TARGETS.filter((t) => ctx.config.targets[t.id].enabled).map((t) => t.id)
      : [];
  const baselineCtx = {
    files: ctx.files,
    text,
    tokenizer,
    config: ctx.config,
    budget: options.budget,
    include: enabled,
  };

  const inputs: AuditInput[] = (await discover(ctx))
    .filter((f) => f.kind === 'instructions')
    .map((f) => ({ path: f.path, content: f.content, agents: f.agents, alwaysOn: f.alwaysOn }));
  const agents = computeBaselines(inputs, baselineCtx);

  const sections = inputs
    .filter((i) => i.alwaysOn)
    .flatMap((i) => sectionsOf(i, tokenizer))
    .sort((a, b) => b.tokens - a.tokens);
  const largeFiles = inputs
    .map((i) => ({ path: i.path, tokens: tokenizer.count(i.content) }))
    .filter((f) => f.tokens > ctx.config.audit.fileWarn)
    .sort((a, b) => b.tokens - a.tokens);

  return {
    tokenizer: { name: tokenizer.name, exact: tokenizer.exact },
    agents,
    projected: await projectedBaselines(ctx, inputs, baselineCtx),
    sections,
    largeFiles,
    overBudget: agents.filter((a) => a.alwaysOn > a.budget).map((a) => a.agent),
  };
}

/** The same numbers for the files `sync` would write (as if run with --force). */
async function projectedBaselines(
  ctx: ProjectContext,
  inputs: readonly AuditInput[],
  baselineCtx: Parameters<typeof computeBaselines>[1],
): Promise<AgentAudit[] | null> {
  const plan = await planSync(ctx, { force: true });
  if (plan.rules.length === 0 || plan.problems.length > 0) return null;
  if (plan.changes.every((c) => c.action === 'unchanged')) return null;

  const projected = new Map(inputs.map((i) => [i.path, i]));
  for (const change of plan.changes) {
    if (change.after === null) {
      projected.delete(change.path);
      continue;
    }
    const frontmatter = parseMarkdown(change.after).frontmatter?.data ?? null;
    projected.set(change.path, {
      path: change.path,
      content: change.after,
      agents: [change.target],
      alwaysOn: getTarget(change.target).isAlwaysOn({ path: change.path, frontmatter }),
    });
  }
  const after = computeBaselines([...projected.values()], baselineCtx);
  const before = computeBaselines(inputs, baselineCtx);
  const same =
    after.length === before.length &&
    after.every(
      (a, i) =>
        a.agent === before[i]?.agent &&
        a.alwaysOn === before[i].alwaysOn &&
        a.conditional === before[i].conditional,
    );
  return same ? null : after;
}
