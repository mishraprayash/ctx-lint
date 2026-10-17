import { joinRel } from '../core/paths.js';
import { renderFrontmatter } from '../syncer/yaml.js';
import type { TargetAdapter } from './adapter.js';

// Project rules live in .cursor/rules (subfolders allowed), as .mdc files. A rule is always applied
// when its frontmatter has `alwaysApply: true`. The legacy .cursorrules file is always applied.
// `globs` is one comma-separated string: Cursor doesn't read YAML lists. See docs/targets.md.
export const cursorTarget: TargetAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  detect: ['**/.cursor/rules/**/*.mdc', '.cursorrules'],
  isAlwaysOn: (file) => file.path === '.cursorrules' || file.frontmatter?.alwaysApply === true,
  docsUrl: 'https://cursor.com/docs/context/rules',

  compile(rules, { config }) {
    const dir = config.targets.cursor.outputDir;
    return rules.map((rule) => ({
      target: 'cursor' as const,
      path: joinRel(dir, `${rule.id}.mdc`),
      // All three keys, in the order Cursor's own editor writes them.
      frontmatter: renderFrontmatter([
        ['description', rule.description ?? null],
        ['globs', rule.kind === 'scoped' ? rule.globs.join(', ') : null],
        ['alwaysApply', rule.kind === 'always'],
      ]),
      body: rule.body,
      perRule: true,
    }));
  },

  ownedDirs: (config) => [config.targets.cursor.outputDir],
};
