import type { Root } from 'mdast';
import type { Config } from '../config/schema.js';
import { dirnameRel, joinRel, normalizeRel } from '../core/paths.js';
import type { AgentId } from '../core/types.js';
import type { FileIndex } from '../fs/file-index.js';
import type { TextCache } from '../fs/text-cache.js';
import { parseMarkdown, walk } from '../parsers/markdown.js';
import { getTarget, TARGETS } from '../targets/registry.js';
import type { Tokenizer } from './tokenizer.js';

// What each agent loads on every request vs. only sometimes (PLAN.md §7.2). See docs/targets.md
// for the sources; agent-specific loading rules live here so the numbers match reality.

/** An instruction file as the auditor sees it: on disk, or what `sync` would write. */
export interface AuditInput {
  path: string;
  content: string;
  agents: AgentId[];
  alwaysOn: boolean;
}

export interface AuditFile {
  path: string;
  tokens: number;
  alwaysOn: boolean;
  /** Why an agent loads this file even though it isn't one of its own. */
  via?: 'import' | 'agents-md';
}

export interface AgentAudit {
  agent: AgentId;
  displayName: string;
  alwaysOn: number;
  conditional: number;
  budget: number;
  files: AuditFile[];
  /** Content repeated across this agent's always-on files: tokens spent more than once. */
  duplicateTokens: number;
  duplicateBlocks: number;
}

export interface BaselineContext {
  files: FileIndex;
  text: TextCache;
  tokenizer: Tokenizer;
  config: Config;
  /** `--budget`: overrides every agent's budget. */
  budget?: number | undefined;
  /** Also report these agents when they only load other agents' files (enabled targets). */
  include?: readonly AgentId[];
}

/** Agents (besides `agents`) that also load the root AGENTS.md on every request. */
const READS_AGENTS_MD: readonly AgentId[] = ['cursor', 'copilot', 'windsurf'];

/** Claude Code follows `@path` imports up to four hops deep. */
const MAX_IMPORT_DEPTH = 4;

export function computeBaselines(
  inputs: readonly AuditInput[],
  ctx: BaselineContext,
): AgentAudit[] {
  const byPath = new Map(inputs.map((i) => [i.path, i]));
  const tokens = memo((input: AuditInput) => ctx.tokenizer.count(stripFrontmatter(input.content)));
  const result: AgentAudit[] = [];

  for (const target of TARGETS) {
    const agent = target.id;
    const own = inputs.filter((i) => i.agents.includes(agent));
    const loaded: { input: AuditInput; via?: AuditFile['via']; alwaysOn: boolean }[] = own.map(
      (input) => ({
        input,
        alwaysOn: input.alwaysOn,
      }),
    );

    const rootAgents = byPath.get('AGENTS.md');
    if (rootAgents && agent !== 'agents') {
      // Claude Code reads AGENTS.md only when there's no CLAUDE.md; the others read it too.
      const claudeHasOwn = own.some(
        (i) => i.alwaysOn && /(^|\/)CLAUDE(\.local)?\.md$/.test(i.path),
      );
      if (READS_AGENTS_MD.includes(agent) || (agent === 'claude' && !claudeHasOwn)) {
        loaded.push({ input: rootAgents, via: 'agents-md', alwaysOn: true });
      }
    }

    if (agent === 'claude') {
      const seen = new Set(loaded.map((l) => l.input.path));
      for (const entry of [...loaded]) {
        if (!entry.alwaysOn) continue;
        for (const imported of resolveImports(entry.input, ctx, seen)) {
          loaded.push({ input: imported, via: 'import', alwaysOn: true });
        }
      }
    }

    // Agents with no files of their own only matter if the project uses them (an enabled target).
    if (loaded.length === 0 || (own.length === 0 && !ctx.include?.includes(agent))) continue;
    const files: AuditFile[] = loaded.map(({ input, via, alwaysOn }) => ({
      path: input.path,
      tokens: tokens(input),
      alwaysOn,
      ...(via ? { via } : {}),
    }));
    const duplicates = duplicateContent(
      loaded.filter((l) => l.alwaysOn).map((l) => l.input),
      ctx.tokenizer,
    );
    result.push({
      agent,
      displayName: getTarget(agent).displayName,
      alwaysOn: sum(files.filter((f) => f.alwaysOn)),
      conditional: sum(files.filter((f) => !f.alwaysOn)),
      budget: ctx.budget ?? ctx.config.audit.budget[agent] ?? ctx.config.audit.budget.default,
      files: files.sort((a, b) => Number(b.alwaysOn) - Number(a.alwaysOn) || b.tokens - a.tokens),
      duplicateTokens: duplicates.tokens,
      duplicateBlocks: duplicates.blocks,
    });
  }
  return result;
}

/** `@path` imports outside code, followed recursively. External and missing files are skipped. */
function resolveImports(
  from: AuditInput,
  ctx: BaselineContext,
  seen: Set<string>,
  depth = 1,
): AuditInput[] {
  if (depth > MAX_IMPORT_DEPTH) return [];
  const out: AuditInput[] = [];
  for (const spec of importSpecs(parseMarkdown(from.content).tree)) {
    if (spec.startsWith('~') || spec.startsWith('/')) continue; // Outside the repo.
    const path = joinRel(dirnameRel(from.path), spec);
    if (path.startsWith('..') || seen.has(path) || !ctx.files.isFile(path)) continue;
    const content = ctx.text.read(path);
    if (content === null) continue;
    seen.add(path);
    const input: AuditInput = { path, content, agents: ['claude'], alwaysOn: true };
    out.push(input, ...resolveImports(input, ctx, seen, depth + 1));
  }
  return out;
}

/** `@path` mentions in text (not code), as Claude Code reads them. A backslash escapes a space. */
export function importSpecs(tree: Root): string[] {
  const specs: string[] = [];
  walk(tree, (node) => {
    if (node.type !== 'text') return;
    for (const match of node.value.matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/g)) {
      const spec = (match[1] as string).replace(/\\ /g, ' ').replace(/[.,;:)]+$/, '');
      if (/^[\w./~-]/.test(spec) && !spec.includes('@')) specs.push(normalizeRel(spec));
    }
  });
  return specs;
}

/**
 * Paragraphs, list items and code blocks (20+ characters) that appear in more than one of the
 * given files. Each extra copy is wasted context.
 */
function duplicateContent(
  inputs: readonly AuditInput[],
  tokenizer: Tokenizer,
): { tokens: number; blocks: number } {
  const seenIn = new Map<string, Set<string>>();
  for (const input of inputs) {
    const content = input.content;
    walk(parseMarkdown(content).tree, (node, parent) => {
      const unit =
        node.type === 'code' ||
        node.type === 'listItem' ||
        (node.type === 'paragraph' && parent?.type !== 'listItem');
      if (!unit || !node.position) return;
      const text = content
        .slice(node.position.start.offset, node.position.end.offset)
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length < 20) return;
      const files = seenIn.get(text) ?? new Set<string>();
      files.add(input.path);
      seenIn.set(text, files);
    });
  }
  let tokens = 0;
  let blocks = 0;
  for (const [text, files] of seenIn) {
    if (files.size < 2) continue;
    blocks++;
    tokens += tokenizer.count(text) * (files.size - 1);
  }
  return { tokens, blocks };
}

export function stripFrontmatter(content: string): string {
  const fm = parseMarkdown(content).frontmatter;
  return fm ? content.slice(fm.range.end.offset) : content;
}

function sum(files: readonly AuditFile[]): number {
  return files.reduce((n, f) => n + f.tokens, 0);
}

function memo<T extends object>(fn: (input: T) => number): (input: T) => number {
  const cache = new WeakMap<T, number>();
  return (input) => {
    let value = cache.get(input);
    if (value === undefined) {
      value = fn(input);
      cache.set(input, value);
    }
    return value;
  };
}
