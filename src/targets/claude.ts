import type { TargetAdapter } from './adapter.js';

// Claude Code loads the project CLAUDE.md files (root, .claude/, and the personal
// CLAUDE.local.md) at startup. Nested CLAUDE.md files load when Claude works in that directory.
const ALWAYS_ON = new Set(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);

export const claudeTarget: TargetAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  detect: ['**/CLAUDE.md', '**/CLAUDE.local.md'],
  isAlwaysOn: (file) => ALWAYS_ON.has(file.path),
  docsUrl: 'https://docs.claude.com/en/docs/claude-code/memory',
};
