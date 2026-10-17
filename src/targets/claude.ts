import { joinRel } from '../core/paths.js';
import { renderFrontmatter } from '../syncer/yaml.js';
import type { OutputFile, TargetAdapter } from './adapter.js';
import { composeDocument, partition } from './compose.js';
import { compileMarkdownFile } from './markdown-target.js';

// Claude Code loads the project CLAUDE.md files (root, .claude/, and the personal
// CLAUDE.local.md) at startup, plus `.claude/rules/*.md` without `paths`. Nested CLAUDE.md files
// and rules with `paths` load when Claude works with matching files. See docs/targets.md.
const ALWAYS_ON = new Set(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);
const RULES_DIR = '.claude/rules';

export const claudeTarget: TargetAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  detect: ['**/CLAUDE.md', '**/CLAUDE.local.md', `${RULES_DIR}/**/*.md`],
  isAlwaysOn: (file) =>
    ALWAYS_ON.has(file.path) || (file.path.startsWith(`${RULES_DIR}/`) && !file.frontmatter?.paths),
  docsUrl: 'https://code.claude.com/docs/en/memory',

  compile(rules, { config }) {
    const { output, scopedRules } = config.targets.claude;
    if (scopedRules !== 'rules') return compileMarkdownFile('claude', rules, output, scopedRules);

    // Scoped rules become `.claude/rules/<id>.md` with `paths`, loaded only for matching files.
    const kinds = partition(rules);
    const files: OutputFile[] = [
      {
        target: 'claude',
        path: output,
        body: composeDocument({ always: kinds.always, scoped: [], onDemand: kinds['on-demand'] }),
        perRule: false,
      },
    ];
    for (const rule of kinds.scoped) {
      files.push({
        target: 'claude',
        path: joinRel(RULES_DIR, `${rule.id}.md`),
        frontmatter: renderFrontmatter([['paths', rule.globs]]),
        body: rule.body,
        perRule: true,
      });
    }
    return files;
  },

  ownedDirs: () => [RULES_DIR],
};
