import type { TargetAdapter } from './adapter.js';

// Repository-wide instructions are always included. Path-specific instruction files apply when
// the files being worked on match `applyTo`; `applyTo: "**"` matches everything.
export const copilotTarget: TargetAdapter = {
  id: 'copilot',
  displayName: 'GitHub Copilot',
  detect: ['.github/copilot-instructions.md', '.github/instructions/**/*.instructions.md'],
  isAlwaysOn: (file) =>
    file.path === '.github/copilot-instructions.md' || file.frontmatter?.applyTo === '**',
  docsUrl:
    'https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot',
};
