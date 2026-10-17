import picomatch from 'picomatch';
import type { ProjectContext } from '../core/context.js';
import type { Reference } from '../core/references.js';
import type { Confidence, Diagnostic, Severity } from '../core/types.js';
import type { LoadedFile } from '../discovery/index.js';
import { Manifests } from '../manifests/index.js';
import { referenceDir } from '../parsers/classify/index.js';
import {
  collectDirectives,
  type DisableDirective,
  Suppressions,
} from '../parsers/disable-comments.js';
import { referencesOf } from '../parsers/references.js';
import { findGenerated } from '../syncer/generated.js';
import type { LintRule, ReportDescriptor, RuleContext } from './rule.js';
import { RULES, UNUSED_DISABLE } from './rules/index.js';

export interface LintOptions {
  /** Severity overrides on top of `check.rules` (e.g. from `--rule`). */
  rules?: Readonly<Record<string, Severity>>;
  /** Run dependency checks (default: true). `--no-deps` sets this to false. */
  deps?: boolean;
  /** Report errors only. */
  quiet?: boolean;
}

export interface FileResult {
  path: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  fixableCount: number;
}

export interface LintResult {
  files: FileResult[];
  errorCount: number;
  warningCount: number;
  fixableCount: number;
  /** Rules that ran, for reporters that describe them (SARIF). */
  rules: readonly LintRule[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Severity of every rule after defaults, `check.rules`, `--no-deps` and overrides. */
export function resolveSeverities(
  ctx: ProjectContext,
  options: LintOptions = {},
): Map<string, Severity> {
  const severities = new Map<string, Severity>();
  for (const rule of RULES) severities.set(rule.id, rule.meta.defaultSeverity);
  for (const [id, severity] of Object.entries(ctx.config.check.rules)) {
    if (severities.has(id)) severities.set(id, severity);
    else ctx.logger.warn(`Unknown rule "${id}" in check.rules (config); ignoring it.`);
  }
  for (const [id, severity] of Object.entries(options.rules ?? {})) severities.set(id, severity);
  if (options.deps === false) severities.set('dependency-installed', 'off');
  return severities;
}

export function lintFiles(
  ctx: ProjectContext,
  files: readonly LoadedFile[],
  options: LintOptions = {},
): LintResult {
  const severities = resolveSeverities(ctx, options);
  const active = RULES.filter((rule) => severities.get(rule.id) !== 'off');
  const manifests = new Manifests(ctx);
  const minRank = CONFIDENCE_RANK[ctx.config.check.minConfidence];
  const ignorePaths = ctx.config.check.ignorePaths;
  const isIgnoredPath =
    ignorePaths.length > 0 ? picomatch(ignorePaths, { dot: true }) : () => false;

  const results = files.map((file) => {
    const raw: Diagnostic[] = [];
    const fileDir = referenceDir(file);

    const contextFor = (rule: LintRule, confidence: Confidence): RuleContext => ({
      project: ctx,
      manifests,
      file,
      fileDir,
      isIgnoredPath: (p) => isIgnoredPath(p),
      report: (d: ReportDescriptor) => {
        const configured = severities.get(rule.id) as Exclude<Severity, 'off'>;
        // Only high-confidence references (and file-level checks) produce errors.
        const severity = d.downgrade || confidence !== 'high' ? 'warn' : configured;
        raw.push({
          ruleId: rule.id,
          severity,
          message: d.message,
          file: file.path,
          range: d.range,
          ...(d.suggestion ? { suggestion: d.suggestion } : {}),
        });
      },
    });

    const refs = referencesOf(ctx, file).filter(
      (c): c is Reference => c.kind !== 'ignored' && CONFIDENCE_RANK[c.confidence] >= minRank,
    );
    for (const rule of active) {
      if (rule.file) rule.file(file, contextFor(rule, 'high'));
      if (rule.reference)
        for (const ref of refs) rule.reference(ref, contextFor(rule, ref.confidence));
    }

    const directives = collectDirectives(file.markdown.tree);
    const suppressions = new Suppressions(directives);
    // Generated content comes from source rules, which are linted themselves: report problems
    // once, where they can be fixed.
    const generated = findGenerated(file.content);
    const inGenerated = (d: Diagnostic) =>
      generated !== null &&
      d.ruleId !== 'generated-file-modified' &&
      d.range.start.offset >= generated.start &&
      d.range.start.offset < generated.end;
    let diagnostics = raw.filter(
      (d) => !inGenerated(d) && !suppressions.isSuppressed(d.ruleId, d.range.start.line),
    );
    if (severities.get(UNUSED_DISABLE.id) !== 'off') {
      diagnostics.push(
        ...unusedDisableDiagnostics(file.path, directives, suppressions.unused(), severities),
      );
    }
    if (options.quiet) diagnostics = diagnostics.filter((d) => d.severity === 'error');
    return summarize(file.path, dedupe(diagnostics));
  });

  return {
    files: results,
    errorCount: sum(results, 'errorCount'),
    warningCount: sum(results, 'warningCount'),
    fixableCount: sum(results, 'fixableCount'),
    rules: active,
  };
}

function unusedDisableDiagnostics(
  file: string,
  directives: readonly DisableDirective[],
  unused: readonly DisableDirective[],
  severities: ReadonlyMap<string, Severity>,
): Diagnostic[] {
  const severity = severities.get(UNUSED_DISABLE.id) as Exclude<Severity, 'off'>;
  const out: Diagnostic[] = [];
  for (const directive of directives) {
    const unknown = (directive.rules ?? []).filter((id) => !severities.has(id));
    if (unknown.length > 0) {
      out.push({
        ruleId: UNUSED_DISABLE.id,
        severity,
        message: `Unknown rule${unknown.length > 1 ? 's' : ''} in ctx-lint directive: ${unknown.join(', ')}.`,
        file,
        range: directive.range,
      });
    } else if (directive.kind !== 'enable' && unused.includes(directive)) {
      const what = directive.rules ? ` from ${directive.rules.join(', ')}` : '';
      out.push({
        ruleId: UNUSED_DISABLE.id,
        severity,
        message: `Unused ctx-lint-${directive.kind} directive (no problems were reported${what}).`,
        file,
        range: directive.range,
      });
    }
  }
  return out;
}

function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics
    .sort(
      (a, b) =>
        a.range.start.offset - b.range.start.offset ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.message.localeCompare(b.message),
    )
    .filter((d) => {
      const key = `${d.ruleId}\0${d.range.start.offset}\0${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function summarize(path: string, diagnostics: Diagnostic[]): FileResult {
  return {
    path,
    diagnostics,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
    warningCount: diagnostics.filter((d) => d.severity === 'warn').length,
    fixableCount: diagnostics.filter((d) => d.suggestion?.replacement !== undefined).length,
  };
}

function sum(
  results: readonly FileResult[],
  key: 'errorCount' | 'warningCount' | 'fixableCount',
): number {
  return results.reduce((n, r) => n + r[key], 0);
}
