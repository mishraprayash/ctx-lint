import type { Config } from '../config/schema.js';
import type { AgentId } from '../core/types.js';
import type { RuleIR } from '../syncer/ir.js';

/** What an adapter gets to look at when deciding things about a discovered file. */
export interface TargetFileInfo {
  /** Repo-relative POSIX path. */
  path: string;
  /** Parsed frontmatter mapping, or `null` (missing or invalid). */
  frontmatter: Record<string, unknown> | null;
}

/** A file a target wants to exist after `sync`. */
export interface OutputFile {
  target: AgentId;
  /** Repo-relative path. */
  path: string;
  /** Generated markdown. Empty means "this file (or block) should not exist". */
  body: string;
  /** Rendered frontmatter (`---…---\n`), written before the generated-file header. */
  frontmatter?: string;
  /** One file per rule: always fully owned by ctx-lint, and deleted when its rule goes away. */
  perRule: boolean;
  /** Problems worth telling the user about (e.g. a size limit). */
  warnings?: string[];
}

export interface CompileContext {
  config: Config;
}

/**
 * Everything ctx-lint knows about one agent's instruction-file format. Format details live
 * here and nowhere else, so a vendor format change stays local (PLAN.md §6.3, docs/targets.md).
 */
export interface TargetAdapter {
  id: AgentId;
  displayName: string;
  /** Globs (relative to the repo root) of the files this agent reads. */
  detect: readonly string[];
  /** Whether the agent loads this file on every request (used by `audit`). */
  isAlwaysOn(file: TargetFileInfo): boolean;
  /** Vendor docs for the format. */
  docsUrl: string;
  /** Compiles source rules (already filtered to this target) into output files. */
  compile(rules: readonly RuleIR[], ctx: CompileContext): OutputFile[];
  /** Directories where per-rule files are written, for cleaning up orphans. */
  ownedDirs(config: Config): string[];
}
