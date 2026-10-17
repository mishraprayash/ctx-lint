import type { TargetAdapter } from './adapter.js';
import { compileMarkdownFile } from './markdown-target.js';

// AGENTS.md is the shared format read by Codex, OpenCode, Amp, Jules, Cursor, Copilot and others.
// The root file is always loaded; the nearest nested file takes precedence. See docs/targets.md.
export const agentsTarget: TargetAdapter = {
  id: 'agents',
  displayName: 'AGENTS.md',
  detect: ['**/AGENTS.md'],
  isAlwaysOn: (file) => file.path === 'AGENTS.md',
  docsUrl: 'https://agents.md',

  compile(rules, { config }) {
    const { output, scopedRules } = config.targets.agents;
    return compileMarkdownFile('agents', rules, output, scopedRules);
  },

  ownedDirs: () => [],
};
