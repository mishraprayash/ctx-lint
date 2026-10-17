import { toString as mdastToString } from 'mdast-util-to-string';
import { parseMarkdown } from '../parsers/markdown.js';
import type { AuditInput } from './baseline.js';
import { stripFrontmatter } from './baseline.js';
import type { Tokenizer } from './tokenizer.js';

export interface Section {
  file: string;
  /** Heading text, or `(top of file)` for text before the first heading. */
  heading: string;
  line: number;
  tokens: number;
}

/** Splits a file at its H1/H2 headings and counts each part. */
export function sectionsOf(input: AuditInput, tokenizer: Tokenizer): Section[] {
  const body = stripFrontmatter(input.content);
  const offset = input.content.length - body.length;
  const lineOf = (index: number) => input.content.slice(0, offset + index).split('\n').length;
  const { tree } = parseMarkdown(body);

  const starts: { heading: string; at: number }[] = [];
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth <= 2 && node.position?.start.offset !== undefined) {
      starts.push({ heading: mdastToString(node), at: node.position.start.offset });
    }
  }
  if (starts[0]?.at !== 0) starts.unshift({ heading: '(top of file)', at: 0 });

  const sections: Section[] = [];
  starts.forEach((start, i) => {
    const text = body.slice(start.at, starts[i + 1]?.at ?? body.length);
    if (text.trim() === '') return;
    sections.push({
      file: input.path,
      heading: start.heading,
      line: lineOf(start.at),
      tokens: tokenizer.count(text),
    });
  });
  return sections;
}
