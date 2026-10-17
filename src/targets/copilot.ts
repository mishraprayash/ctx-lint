import { joinRel } from '../core/paths.js';
import { renderFrontmatter } from '../syncer/yaml.js';
import type { OutputFile, TargetAdapter } from './adapter.js';
import { composeDocument, partition } from './compose.js';

// Repository-wide instructions are always included. Path-specific instruction files apply when
// the files being worked on match `applyTo` (a quoted, comma-separated glob string); `"**"` matches
// everything. See docs/targets.md.
const INSTRUCTIONS_DIR = '.github/instructions';

export const copilotTarget: TargetAdapter = {
  id: 'copilot',
  displayName: 'GitHub Copilot',
  detect: ['.github/copilot-instructions.md', `${INSTRUCTIONS_DIR}/**/*.instructions.md`],
  isAlwaysOn: (file) =>
    file.path === '.github/copilot-instructions.md' || file.frontmatter?.applyTo === '**',
  docsUrl:
    'https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions',

  compile(rules, { config }) {
    const { output, scopedRules } = config.targets.copilot;
    const kinds = partition(rules);
    const split = scopedRules === 'instructions';
    const files: OutputFile[] = [
      {
        target: 'copilot',
        path: output,
        body: composeDocument({
          always: kinds.always,
          scoped: split ? [] : kinds.scoped,
          onDemand: kinds['on-demand'],
        }),
        perRule: false,
      },
    ];
    if (split) {
      for (const rule of kinds.scoped) {
        files.push({
          target: 'copilot',
          path: joinRel(INSTRUCTIONS_DIR, `${rule.id}.instructions.md`),
          frontmatter: renderFrontmatter(
            [
              ['description', rule.description],
              ['applyTo', rule.globs.join(',')],
            ],
            { quote: new Set(['applyTo']) },
          ),
          body: rule.body,
          perRule: true,
        });
      }
    }
    return files;
  },

  ownedDirs: (config) =>
    config.targets.copilot.scopedRules === 'instructions' ? [INSTRUCTIONS_DIR] : [],
};
