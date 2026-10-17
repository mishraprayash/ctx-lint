import type { TargetAdapter } from './adapter.js';

// AGENTS.md is the shared format read by Codex, OpenCode, Amp, Jules and others. The root file
// is always loaded; nested files apply to their directory.
export const agentsTarget: TargetAdapter = {
  id: 'agents',
  displayName: 'AGENTS.md',
  detect: ['**/AGENTS.md'],
  isAlwaysOn: (file) => file.path === 'AGENTS.md',
  docsUrl: 'https://agents.md',
};
