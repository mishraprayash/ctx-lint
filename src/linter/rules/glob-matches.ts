import { joinRel } from '../../core/paths.js';
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

    for (const base of basesFor(ref, ctx.file.path, ctx.fileDir)) {
      const glob = ref.bare ? `**/${ref.value}` : joinRel(base, ref.value);
      const prefix = staticPrefix(glob);
      // Globs into unwalked or ignored directories (node_modules, dist) can't be checked.
      if (prefix !== '' && (files.isUnindexed(prefix) || ctx.isIgnoredPath(prefix))) return;
      if (files.matchAny(glob).length > 0) return;
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
  if (ref.candidate.origin === 'frontmatter') {
    const owner = /^(.*?)\/?\.(?:cursor|windsurf|github)\//.exec(filePath)?.[1] ?? '';
    return owner === '' ? [''] : ['', owner];
  }
  return fileDir === '' ? [''] : ['', fileDir];
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
