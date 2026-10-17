import type { TargetAdapter } from './adapter.js';

// Project rules live in .cursor/rules (also nested in subdirectories). A rule is always applied
// when its frontmatter has `alwaysApply: true`. The legacy .cursorrules file is always applied.
export const cursorTarget: TargetAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  detect: ['**/.cursor/rules/**/*.mdc', '.cursorrules'],
  isAlwaysOn: (file) => file.path === '.cursorrules' || file.frontmatter?.alwaysApply === true,
  docsUrl: 'https://docs.cursor.com/context/rules',
};
