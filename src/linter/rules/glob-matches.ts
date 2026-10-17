import { dirnameRel, joinRel } from '../../core/paths.js';
import type { PathReference } from '../../core/references.js';
import type { LintRule } from '../rule.js';
import { sourceText } from './util.js';

export const globMatches: LintRule = {
  id: 'glob-matches',
  meta: {
    description:
      'Globs (in text and in rule frontmatter such as `globs` and `applyTo`) match at least one file.',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'path' || !ref.isGlob) return;
    const files = ctx.project.files;

    // `*.py` in rule frontmatter matches at any depth, as in .gitignore (Cursor, Copilot).
    const anyDepth =
      ref.bare || (ref.candidate.origin === 'frontmatter' && !ref.value.includes('/'));
    for (const base of basesFor(ref, ctx.file.path, ctx.fileDir)) {
      const glob = anyDepth ? joinRel(base, `**/${ref.value}`) : joinRel(base, ref.value);
      const prefix = staticPrefix(glob);
      // Globs into unwalked, ignored or gitignored directories (node_modules, build output) can't be checked.
      if (
        prefix !== '' &&
        (files.isUnindexed(prefix) ||
          ctx.isIgnoredPath(prefix) ||
          files.wouldBeIgnored(prefix, 'dir'))
      ) {
        return;
      }
      if (files.hasMatch(glob)) return;
    }

    ctx.report({
      message: `Glob "${sourceText(ctx, ref.range)}" matches no files.`,
      range: ref.range,
    });
  },
};

/**
 * Directories a glob may be relative to. Frontmatter globs are repo-relative, and for nested
 * rule folders (`apps/web/.cursor/rules/x.mdc`) also relative to the folder that holds them.
 */
function basesFor(ref: PathReference, filePath: string, fileDir: string): string[] {
  if (ref.fromFile || ref.rooted || ref.bare) return [''];
  // Frontmatter globs (in a nested `.cursor/rules`, also relative to the folder that holds it).
  if (ref.candidate.origin === 'frontmatter') {
    const owner = /^(.*?)\/?\.(?:cursor|windsurf|github)\//.exec(filePath)?.[1] ?? '';
    return owner === '' ? [''] : ['', owner];
  }
  // Like paths: the root, then the file's directory and each directory up from it.
  const bases = [''];
  for (let dir = fileDir; dir !== ''; dir = dirnameRel(dir)) bases.push(dir);
  return bases;
}

/** The directory part of a glob before its first wildcard: `src/api/**` → `src/api`. */
function staticPrefix(glob: string): string {
  const segments: string[] = [];
  for (const segment of glob.split('/')) {
    if (/[*?{[]/.test(segment)) break;
    segments.push(segment);
  }
  return segments.join('/');
}
