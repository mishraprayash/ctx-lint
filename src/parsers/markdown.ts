import type { Nodes, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter as frontmatterSyntax } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import type { Range } from '../core/types.js';
import { type Frontmatter, parseFrontmatter } from './frontmatter.js';

export interface ParsedMarkdown {
  tree: Root;
  /** YAML frontmatter, or `null` when the file has none. */
  frontmatter: Frontmatter | null;
}

/**
 * Parses CommonMark + GFM with optional YAML frontmatter. Positions are exact. `lenient`
 * frontmatter is for Cursor `.mdc` files (see `parseFrontmatter`).
 */
export function parseMarkdown(
  content: string,
  options: { lenient?: boolean } = {},
): ParsedMarkdown {
  const tree = fromMarkdown(content, {
    extensions: [gfm(), frontmatterSyntax(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
  });

  const first = tree.children[0];
  const range = first?.type === 'yaml' ? rangeOf(first) : undefined;
  const frontmatter =
    first?.type === 'yaml' && range
      ? parseFrontmatter(
          first.value,
          range,
          content.indexOf('\n', range.start.offset) + 1,
          options.lenient === true,
        )
      : null;

  return { tree, frontmatter };
}

/** The node's range, or `undefined` for generated nodes without a position. */
export function rangeOf(node: Nodes): Range | undefined {
  const { position } = node;
  if (!position || position.start.offset === undefined || position.end.offset === undefined) {
    return undefined;
  }
  return {
    start: {
      line: position.start.line,
      column: position.start.column,
      offset: position.start.offset,
    },
    end: { line: position.end.line, column: position.end.column, offset: position.end.offset },
  };
}

/** Depth-first, pre-order walk over every node in the tree. */
export function walk(node: Nodes, visit: (node: Nodes, parent: Nodes | null) => void): void {
  const stack: [Nodes, Nodes | null][] = [[node, null]];
  while (stack.length > 0) {
    const [current, parent] = stack.pop() as [Nodes, Nodes | null];
    visit(current, parent);
    if ('children' in current) {
      for (let i = current.children.length - 1; i >= 0; i--) {
        stack.push([current.children[i] as Nodes, current]);
      }
    }
  }
}
