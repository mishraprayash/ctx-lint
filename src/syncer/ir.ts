import { readFile } from 'node:fs/promises';
import type { ProjectContext } from '../core/context.js';
import { normalizeRel, toAbsolute } from '../core/paths.js';
import { AGENT_IDS, type AgentId } from '../core/types.js';
import { splitGlobList } from '../parsers/extract.js';
import { parseMarkdown } from '../parsers/markdown.js';
import { SOURCE_FRONTMATTER } from '../targets/frontmatter.js';

// Source rules (`.context/rules/**/*.md`) → the target-independent rule IR (PLAN.md §6.1–6.2).

export type RuleKind = 'always' | 'scoped' | 'on-demand';

export interface RuleIR {
  /** Path below the sources directory without `.md`: `backend/api`. */
  id: string;
  kind: RuleKind;
  description?: string;
  globs: string[];
  /** Markdown body: frontmatter removed, trimmed. */
  body: string;
  /** Targets this rule is compiled for (already intersected with the enabled ones). */
  targets: AgentId[];
  priority: number;
  /** Repo-relative path of the source file. */
  sourcePath: string;
}

export interface SourceProblem {
  file: string;
  message: string;
}

export interface LoadedSources {
  rules: RuleIR[];
  problems: SourceProblem[];
}

/** Loads and validates every source rule, sorted by priority, then id. */
export async function loadSources(ctx: ProjectContext): Promise<LoadedSources> {
  const dir = normalizeRel(ctx.config.sources);
  const paths = ctx.files.match(`${dir}/**/*.md`);
  const rules: RuleIR[] = [];
  const problems: SourceProblem[] = [];

  for (const path of paths) {
    const content = await readFile(toAbsolute(ctx.root, path), 'utf8');
    const result = parseSourceRule(path, path.slice(dir.length + 1).replace(/\.md$/, ''), content);
    if ('problems' in result) problems.push(...result.problems);
    else rules.push(result.rule);
  }

  rules.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return { rules, problems };
}

/** Parses one source rule. `targets` lists every agent unless the rule restricts them. */
export function parseSourceRule(
  sourcePath: string,
  id: string,
  content: string,
): { rule: RuleIR } | { problems: SourceProblem[] } {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const { frontmatter } = parseMarkdown(text);
  const fail = (message: string) => ({ problems: [{ file: sourcePath, message }] });

  if (frontmatter?.error) return fail(`invalid frontmatter: ${frontmatter.error.message}`);
  const data = frontmatter?.data ?? {};

  const problems: SourceProblem[] = [];
  for (const [key, value] of Object.entries(data)) {
    const field = SOURCE_FRONTMATTER.fields[key];
    if (!field) problems.push({ file: sourcePath, message: `unknown frontmatter key "${key}"` });
    else if (!field.schema.safeParse(value).success) {
      problems.push({ file: sourcePath, message: `"${key}" must be ${field.expected}` });
    }
  }
  if (problems.length > 0) return { problems };

  const globs = toGlobList(data.globs);
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  // Default: always applied unless the rule is scoped to globs.
  const alwaysApply = typeof data.alwaysApply === 'boolean' ? data.alwaysApply : globs.length === 0;
  let kind: RuleKind;
  if (alwaysApply) kind = 'always';
  else if (globs.length > 0) kind = 'scoped';
  else if (description !== '') kind = 'on-demand';
  else
    return fail(
      '`alwaysApply: false` needs `globs` or a `description`, or no agent will ever load it',
    );

  const body = (frontmatter ? text.slice(frontmatter.range.end.offset) : text).trim();
  if (body === '') return fail('the rule has no content');

  return {
    rule: {
      id,
      kind,
      ...(description !== '' ? { description } : {}),
      globs,
      body,
      targets: Array.isArray(data.targets) ? (data.targets as AgentId[]) : [...AGENT_IDS],
      priority: typeof data.priority === 'number' ? data.priority : 0,
      sourcePath,
    },
  };
}

function toGlobList(value: unknown): string[] {
  if (typeof value === 'string') return splitGlobList(value);
  if (Array.isArray(value))
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
  return [];
}
