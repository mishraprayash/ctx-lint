import type { TargetAdapter } from './adapter.js';

// Workspace rules live in .windsurf/rules with a `trigger` (always_on, glob, model_decision,
// manual). The legacy .windsurfrules file is always applied.
export const windsurfTarget: TargetAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
  detect: ['**/.windsurf/rules/**/*.md', '.windsurfrules'],
  isAlwaysOn: (file) => file.path === '.windsurfrules' || file.frontmatter?.trigger === 'always_on',
  docsUrl: 'https://docs.windsurf.com/windsurf/cascade/memories',
};
