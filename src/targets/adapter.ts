import type { AgentId } from '../core/types.js';

/** What an adapter gets to look at when deciding things about a discovered file. */
export interface TargetFileInfo {
  /** Repo-relative POSIX path. */
  path: string;
  /** Parsed frontmatter mapping, or `null` (missing or invalid). */
  frontmatter: Record<string, unknown> | null;
}

/**
 * Everything ctx-lint knows about one agent's instruction-file format. Format details live
 * here and nowhere else, so a vendor format change stays local (PLAN.md §6.3, §12).
 *
 * `compile` (for `sync`) is added in Phase 4.
 */
export interface TargetAdapter {
  id: AgentId;
  displayName: string;
  /** Globs (relative to the repo root) of the files this agent reads. */
  detect: readonly string[];
  /** Whether the agent loads this file on every request (used by `audit`). */
  isAlwaysOn(file: TargetFileInfo): boolean;
  /** Vendor docs for the format, for `docs/targets.md` and error messages. */
  docsUrl: string;
}
