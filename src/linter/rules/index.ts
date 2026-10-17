import type { LintRule } from '../rule.js';
import { binExists } from './bin-exists.js';
import { dependencyInstalled } from './dependency-installed.js';
import { frontmatterValid } from './frontmatter-valid.js';
import { globMatches } from './glob-matches.js';
import { linkAnchor } from './link-anchor.js';
import { makeTargetExists } from './make-target-exists.js';
import { packageManagerMismatch } from './package-manager-mismatch.js';
import { pathCase } from './path-case.js';
import { pathExists } from './path-exists.js';
import { scriptExists } from './script-exists.js';

/** Reported by the engine itself: it needs every other rule's results first. */
export const UNUSED_DISABLE: LintRule = {
  id: 'unused-disable',
  meta: {
    description: 'ctx-lint disable directives suppress something and name rules that exist.',
    defaultSeverity: 'warn',
  },
};

/** Every rule, in the order they're documented (PLAN.md §5.4). */
export const RULES: readonly LintRule[] = [
  pathExists,
  pathCase,
  globMatches,
  linkAnchor,
  scriptExists,
  makeTargetExists,
  binExists,
  packageManagerMismatch,
  dependencyInstalled,
  frontmatterValid,
  UNUSED_DISABLE,
];

export function getRule(id: string): LintRule | undefined {
  return RULES.find((rule) => rule.id === id);
}
