import { joinRel } from '../core/paths.js';
import { renderFrontmatter } from '../syncer/yaml.js';
import type { TargetAdapter } from './adapter.js';

// Windsurf is now Devin Desktop: workspace rules live in .devin/rules (preferred) or
// .windsurf/rules, with a `trigger` (always_on, glob, model_decision, manual). The legacy
// .windsurfrules file is always applied. Rule files are capped at 12,000 characters.
// See docs/targets.md.
const MAX_CHARS = 12_000;

export const windsurfTarget: TargetAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf / Devin Desktop',
  detect: ['**/.windsurf/rules/**/*.md', '**/.devin/rules/**/*.md', '.windsurfrules'],
  isAlwaysOn: (file) => file.path === '.windsurfrules' || file.frontmatter?.trigger === 'always_on',
  docsUrl: 'https://docs.devin.ai/desktop/cascade/memories',

  compile(rules, { config }) {
    const dir = config.targets.windsurf.outputDir;
    return rules.map((rule) => {
      const trigger =
        rule.kind === 'always' ? 'always_on' : rule.kind === 'scoped' ? 'glob' : 'model_decision';
      const frontmatter = renderFrontmatter([
        ['trigger', trigger],
        ['description', rule.description],
        ['globs', rule.kind === 'scoped' ? rule.globs.join(', ') : undefined],
      ]);
      const size = frontmatter.length + rule.body.length;
      return {
        target: 'windsurf' as const,
        // The docs don't mention subfolders inside the rules directory, so ids are flattened.
        path: joinRel(dir, `${rule.id.replaceAll('/', '-')}.md`),
        frontmatter,
        body: rule.body,
        perRule: true,
        ...(size > MAX_CHARS
          ? {
              warnings: [
                `${rule.sourcePath} is ${size} characters; Windsurf reads at most ${MAX_CHARS} per rule file.`,
              ],
            }
          : {}),
      };
    });
  },

  ownedDirs: (config) => [config.targets.windsurf.outputDir],
};
