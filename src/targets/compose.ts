import { joinRel } from '../core/paths.js';
import type { RuleIR } from '../syncer/ir.js';

// Shared layout for single-file markdown targets (CLAUDE.md, AGENTS.md, copilot-instructions.md):
//
//   <always-applied rules, each as a section>
//
//   ## Path-specific rules
//   ### Files matching `src/api/**/*.ts`
//
//   ## Optional guidance
//   ### <description>

export interface DocumentParts {
  always: readonly RuleIR[];
  /** Scoped rules rendered as sections (not split into their own files). */
  scoped: readonly RuleIR[];
  onDemand: readonly RuleIR[];
}

export function composeDocument({ always, scoped, onDemand }: DocumentParts): string {
  const out: string[] = always.map((rule) => sectionFor(rule, 2, titleOf(rule)));

  if (scoped.length > 0) {
    out.push('## Path-specific rules');
    for (const rule of scoped) out.push(sectionFor(rule, 3, `Files matching ${globLabel(rule)}`));
  }
  if (onDemand.length > 0) {
    out.push('## Optional guidance', 'Apply these only when they are relevant to the task.');
    for (const rule of onDemand) out.push(sectionFor(rule, 3, rule.description ?? titleOf(rule)));
  }
  return out.join('\n\n');
}

/**
 * A rule under a heading. Bodies that already start with a heading keep it (at this level)
 * unless we're adding context the body can't have (the globs, for scoped rules). Headings inside
 * the body are shifted so they nest under the section.
 */
function sectionFor(rule: RuleIR, level: number, title: string): string {
  if (level === 2 && /^#{1,6}\s/.test(rule.body)) return shiftHeadings(rule.body, level);
  return `${'#'.repeat(level)} ${title}\n\n${shiftHeadings(rule.body, level + 1)}`;
}

/** Shifts ATX headings (outside code fences) so the highest one is at `level` (max 6). */
export function shiftHeadings(body: string, level: number): string {
  const lines = body.split('\n');
  const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
  let inFence = false;
  let top = 7;
  for (const line of lines) {
    if (isFence(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6})\s/.exec(line);
    if (m) top = Math.min(top, (m[1] as string).length);
  }
  if (top === 7 || top === level) return body;
  const delta = level - top;
  inFence = false;
  return lines
    .map((line) => {
      if (isFence(line)) inFence = !inFence;
      const m = !inFence && /^(#{1,6})(\s.*)$/.exec(line);
      return m
        ? `${'#'.repeat(Math.min(6, Math.max(1, (m[1] as string).length + delta)))}${m[2]}`
        : line;
    })
    .join('\n');
}

/** A heading for a rule: its description, or a humanized file name (`api-routes` → `Api routes`). */
export function titleOf(rule: RuleIR): string {
  if (rule.description) return rule.description;
  const name = rule.id.split('/').pop() ?? rule.id;
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function globLabel(rule: RuleIR): string {
  return rule.globs.map((g) => `\`${g}\``).join(', ');
}

export function partition(rules: readonly RuleIR[]): Record<RuleIR['kind'], RuleIR[]> {
  return {
    always: rules.filter((r) => r.kind === 'always'),
    scoped: rules.filter((r) => r.kind === 'scoped'),
    'on-demand': rules.filter((r) => r.kind === 'on-demand'),
  };
}

/** The directory part of a glob before any wildcard: `src/api/**` → `src/api`. */
export function staticDir(glob: string): string {
  const segments: string[] = [];
  for (const segment of glob.split('/')) {
    if (/[*?{[]/.test(segment)) break;
    segments.push(segment);
  }
  // `src/index.ts` is a file: its directory is `src`.
  if (segments.length === glob.split('/').length) segments.pop();
  return joinRel(...segments);
}

/**
 * Groups scoped rules by the single directory all their globs live in, for nested files.
 * Rules whose globs don't share one directory come back in `rest`.
 */
export function groupByDirectory(rules: readonly RuleIR[]): {
  byDir: Map<string, RuleIR[]>;
  rest: RuleIR[];
} {
  const byDir = new Map<string, RuleIR[]>();
  const rest: RuleIR[] = [];
  for (const rule of rules) {
    const dirs = new Set(rule.globs.map(staticDir));
    const [dir] = [...dirs];
    if (dirs.size === 1 && dir) byDir.set(dir, [...(byDir.get(dir) ?? []), rule]);
    else rest.push(rule);
  }
  return { byDir, rest };
}

/** A section for a rule in a nested file, noting the globs when they're narrower than the directory. */
export function nestedSection(rule: RuleIR, dir: string): string {
  const coversDir = rule.globs.every((g) => g === `${dir}/**` || g === `${dir}/**/*`);
  const scope = coversDir ? '' : `Applies to files matching ${globLabel(rule)}.\n\n`;
  return `## ${titleOf(rule)}\n\n${scope}${shiftHeadings(rule.body, 3)}`;
}
