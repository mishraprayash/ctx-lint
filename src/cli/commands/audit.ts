import { Command, Option } from 'commander';
import { type AuditResult, audit } from '../../api/audit.js';
import type { AgentAudit } from '../../auditor/baseline.js';
import type { TokenizerName } from '../../auditor/tokenizer.js';
import { ExitCode } from '../../core/exit-codes.js';
import type { Colors } from '../../core/logger.js';
import { VERSION } from '../../core/version.js';
import { contextFor, globalOptions, loggerFor } from '../global-options.js';
import type { CommandRuntime } from '../io.js';
import { parseCount } from '../option-parsers.js';

interface AuditCliOptions {
  budget?: number;
  tokenizer?: TokenizerName;
  format: 'table' | 'json';
  perSection?: boolean;
  warnOnly?: boolean;
}

export function auditCommand(runtime: CommandRuntime): Command {
  return new Command('audit')
    .description('Estimate token cost per agent and check the always-on budget')
    .option(
      '--budget <tokens>',
      'always-on token budget for every agent (default: audit.budget)',
      parseCount,
    )
    .addOption(
      new Option('--tokenizer <name>', 'tokenizer (default: audit.tokenizer, "heuristic")').choices(
        ['heuristic', 'o200k', 'cl100k'],
      ),
    )
    .addOption(
      new Option('--format <format>', 'output format').choices(['table', 'json']).default('table'),
    )
    .option('--per-section', 'list every section of the always-on files')
    .option('--warn-only', 'never exit non-zero for budget overruns')
    .action(async (options: AuditCliOptions, command: Command) => {
      const globals = globalOptions(command);
      const logger = loggerFor(globals, runtime);
      const ctx = await contextFor(globals, logger);
      const result = await audit(ctx, {
        ...(options.tokenizer ? { tokenizer: options.tokenizer } : {}),
        ...(options.budget !== undefined ? { budget: options.budget } : {}),
      });

      runtime.stdout(
        options.format === 'json'
          ? `${JSON.stringify({ version: 1, tool: { name: 'ctx-lint', version: VERSION }, ...result }, null, 2)}\n`
          : formatTable(result, logger.colors, options.perSection === true),
      );
      if (result.overBudget.length > 0 && !options.warnOnly) runtime.exitCode = ExitCode.Failure;
    });
}

function formatTable(result: AuditResult, c: Colors, perSection: boolean): string {
  const out: string[] = [];
  const how = result.tokenizer.exact
    ? `${result.tokenizer.name} tokenizer`
    : 'heuristic tokenizer, typically within 10% of o200k';
  out.push(
    c.dim(`≈ Estimated tokens (${how}; Claude's tokenizer differs, so treat these as estimates).`),
    '',
  );

  if (result.agents.length === 0) {
    out.push('No agent instruction files found.');
    return `${out.join('\n')}\n`;
  }

  out.push(...agentTable(result.agents, c));
  if (result.projected) {
    out.push(
      '',
      c.bold('After `ctx-lint sync` (projected from .context/rules)'),
      ...agentTable(result.projected, c),
    );
  }

  const sections = perSection ? result.sections : result.sections.slice(0, 5);
  if (sections.length > 0) {
    out.push('', c.bold(perSection ? 'Always-on sections' : 'Largest always-on sections'));
    const where = sections.map((s) => `${s.file}:${s.line}`);
    const width = Math.max(...where.map((w) => w.length));
    const headingWidth = Math.min(48, Math.max(...sections.map((s) => s.heading.length)));
    sections.forEach((s, i) => {
      const heading = s.heading.length > 48 ? `${s.heading.slice(0, 47)}…` : s.heading;
      out.push(
        `  ${c.dim((where[i] as string).padEnd(width))}  ${heading.padEnd(headingWidth)}  ${fmt(s.tokens).padStart(7)}`,
      );
    });
    if (!perSection && result.sections.length > sections.length) {
      out.push(c.dim(`  … ${result.sections.length - sections.length} more (--per-section)`));
    }
  }

  const duplicated = result.agents.filter((a) => a.duplicateBlocks > 0);
  if (duplicated.length > 0) {
    out.push(
      '',
      c.bold('Duplicated content'),
      c.dim('  The same text in several files an agent always loads:'),
    );
    for (const a of duplicated) {
      out.push(
        `  ${a.displayName.padEnd(26)} ${a.duplicateBlocks} block${a.duplicateBlocks === 1 ? '' : 's'}, ≈ ${fmt(a.duplicateTokens)} tokens`,
      );
    }
  }

  if (result.largeFiles.length > 0) {
    out.push('', c.bold('Large files'));
    for (const f of result.largeFiles)
      out.push(`  ${c.yellow('⚠')} ${f.path} ≈ ${fmt(f.tokens)} tokens`);
  }

  out.push('');
  if (result.overBudget.length > 0) {
    out.push(
      c.red(
        `✖ Over the always-on budget: ${result.overBudget.join(', ')}. Move details into scoped rules (globs) or on-demand rules.`,
      ),
    );
  } else {
    out.push(`${c.green('✔')} Every agent is within its always-on budget.`);
  }
  return `${out.join('\n')}\n`;
}

function agentTable(agents: readonly AgentAudit[], c: Colors): string[] {
  const nameWidth = Math.max(5, ...agents.map((a) => a.displayName.length));
  const lines = [
    c.dim(
      `  ${'Agent'.padEnd(nameWidth)}  ${'Always-on'.padStart(9)}  ${'Conditional'.padStart(11)}  ${'Budget'.padStart(7)}  Status`,
    ),
  ];
  for (const a of agents) {
    const over = a.alwaysOn - a.budget;
    const status = over > 0 ? c.red(`✖ over by ${fmt(over)}`) : c.green('✔');
    lines.push(
      `  ${a.displayName.padEnd(nameWidth)}  ${fmt(a.alwaysOn).padStart(9)}  ${(a.conditional > 0 ? fmt(a.conditional) : '—').padStart(11)}  ${fmt(a.budget).padStart(7)}  ${status}`,
    );
  }
  return lines;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
