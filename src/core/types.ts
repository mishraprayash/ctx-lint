// Shared data types. See PLAN.md §3.3.

export type Severity = 'error' | 'warn' | 'off';

export const AGENT_IDS = ['claude', 'agents', 'cursor', 'copilot', 'windsurf'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** 1-based line and column, 0-based offset (matches mdast/unist). */
export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/**
 * - `instructions`: a file an agent reads (CLAUDE.md, .mdc, …)
 * - `source`: a ctx-lint source rule in `.context/rules`
 * - `extra`: included via `check.include` or a CLI argument, not tied to an agent
 */
export type SourceFileKind = 'instructions' | 'source' | 'extra';

export interface SourceFile {
  /** Repo-relative path with POSIX separators. */
  path: string;
  absPath: string;
  kind: SourceFileKind;
  /** Agents that read this file. Empty for `source` and `extra` files. */
  agents: AgentId[];
  content: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Diagnostic {
  ruleId: string;
  severity: Exclude<Severity, 'off'>;
  message: string;
  /** Repo-relative path. */
  file: string;
  range: Range;
  suggestion?: { message: string; replacement?: string };
}
