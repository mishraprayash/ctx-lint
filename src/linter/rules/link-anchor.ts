import type { Root } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import { parseMarkdown, walk } from '../../parsers/markdown.js';
import { resolvePath } from '../resolve.js';
import type { LintRule, RuleContext } from '../rule.js';
import { closest, orList } from '../suggest.js';

const MARKDOWN = /\.(?:md|mdx|mdc|markdown)$/i;

export const linkAnchor: LintRule = {
  id: 'link-anchor',
  meta: {
    description: 'Links to a `#heading` in another markdown file point at a heading that exists.',
    defaultSeverity: 'warn',
  },
  reference(ref, ctx) {
    if (ref.kind !== 'path' || ref.anchor === undefined) return;
    if (/^L\d+(?:-L?\d+)?$/.test(ref.anchor)) return; // GitHub line anchors.
    const resolution = resolvePath(ref, ctx.project.files, ctx.fileDir);
    if (resolution.status !== 'found' || resolution.type !== 'file') return; // path-exists reports it.
    if (!MARKDOWN.test(resolution.path)) return;

    const anchors = anchorsOf(ctx, resolution.path);
    const wanted = safeDecode(ref.anchor).toLowerCase();
    if (anchors.has(wanted)) return;

    const near = closest(wanted, anchors);
    ctx.report({
      message: `Heading "#${ref.anchor}" not found in ${resolution.path}.${near.length > 0 ? ` Did you mean ${orList(near.map((a) => `#${a}`))}?` : ''}`,
      range: ref.range,
    });
  },
};

const anchorCache = new WeakMap<RuleContext['manifests'], Map<string, Set<string>>>();

function anchorsOf(ctx: RuleContext, file: string): Set<string> {
  let byFile = anchorCache.get(ctx.manifests);
  if (!byFile) {
    byFile = new Map();
    anchorCache.set(ctx.manifests, byFile);
  }
  let anchors = byFile.get(file);
  if (!anchors) {
    anchors = collectAnchors(ctx.manifests.text.read(file) ?? '');
    byFile.set(file, anchors);
  }
  return anchors;
}

/** GitHub-style heading slugs plus explicit `id`/`name` anchors. */
export function collectAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const tree: Root = parseMarkdown(markdown).tree;
  walk(tree, (node) => {
    if (node.type === 'heading') {
      const base = githubSlug(mdastToString(node));
      const seen = counts.get(base) ?? 0;
      counts.set(base, seen + 1);
      anchors.add(seen === 0 ? base : `${base}-${seen}`);
    } else if (node.type === 'html') {
      for (const match of node.value.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) {
        if (match[1]) anchors.add(match[1].toLowerCase());
      }
    }
  });
  return anchors;
}

/** How GitHub turns a heading into an anchor: lowercase, punctuation dropped, spaces → `-`. */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
