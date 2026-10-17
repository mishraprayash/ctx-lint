import type { Code, Definition, Image, InlineCode, Link, Nodes, PhrasingContent } from 'mdast';
import { LineMap } from '../core/line-map.js';
import type { Candidate, CandidateOrigin } from '../core/references.js';
import type { Range } from '../core/types.js';
import type { ParsedMarkdown } from './markdown.js';
import { walk } from './markdown.js';

// Turns a parsed markdown file into raw candidates (PLAN.md §5.2). No classification happens
// here: a candidate is just "something that might be a reference", with an exact location.

export interface ExtractInput {
  path: string;
  content: string;
  markdown: ParsedMarkdown;
}

/** Fenced code languages whose lines are read as shell commands. */
export const SHELL_LANGS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'shell',
  'shellscript',
  'console',
  'terminal',
  'shell-session',
  'shellsession',
  'powershell',
  'ps1',
  'pwsh',
  'cmd',
  'bat',
  'batch',
]);

/** Languages where output is mixed with commands, so only lines with a prompt count. */
const PROMPT_REQUIRED_LANGS: ReadonlySet<string> = new Set([
  'console',
  'terminal',
  'shell-session',
  'shellsession',
]);

/** Fenced code languages whose import specifiers are read as package candidates. */
export const IMPORT_LANGS: ReadonlySet<string> = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'javascript',
  'ts',
  'tsx',
  'mts',
  'cts',
  'typescript',
  'vue',
  'svelte',
  'astro',
]);

/** Frontmatter keys that hold globs: Cursor/Windsurf/source rules (`globs`), Copilot (`applyTo`), Claude rules (`paths`). */
const GLOB_KEYS = ['globs', 'applyTo', 'paths'] as const;

/** `cat <<EOF`, `cat <<-'EOF'`: the delimiter that ends the heredoc body. */
const HEREDOC = /<<-?\s*['"]?([A-Za-z_][\w-]*)['"]?/;

/**
 * A shell prompt at the start of a line: `$ `, `% `, `❯ `, `PS C:\repo> `. A bare `> ` is not
 * a prompt (npm prints `> pkg@1.0.0 test` as output); it only counts as a continuation prompt.
 */
const PROMPT = /^(?:\$|%|❯|PS(?: [^>]*)?>)[ \t]+/;

export function extractCandidates(input: ExtractInput): Candidate[] {
  const lines = new LineMap(input.content);
  const out: Candidate[] = [];
  const contexts = inlineContexts(input.markdown);

  walk(input.markdown.tree, (node) => {
    switch (node.type) {
      case 'inlineCode':
        pushInlineCode(out, input, lines, node, contexts.get(node));
        break;
      case 'code':
        pushCodeBlock(out, input, lines, node);
        break;
      case 'link':
      case 'image':
      case 'definition':
        pushLink(out, input, lines, node);
        break;
      default:
        break;
    }
  });
  pushFrontmatterGlobs(out, input, lines);

  return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

// ---------------------------------------------------------------------------------------------
// Locating

interface Segment {
  /** Index in the candidate's raw text where this segment starts. */
  rawStart: number;
  /** File offset of that index. */
  offset: number;
}

/** Builds a candidate whose raw text is made of contiguous segments of the file. */
function candidate(
  input: ExtractInput,
  lines: LineMap,
  raw: string,
  origin: CandidateOrigin,
  segments: readonly Segment[],
  extra: Partial<Pick<Candidate, 'lang' | 'context' | 'frontmatterKey'>> = {},
): Candidate {
  const toOffset = (i: number): number => {
    let seg = segments[0] as Segment;
    for (const s of segments) {
      if (s.rawStart <= i) seg = s;
      else break;
    }
    return seg.offset + (i - seg.rawStart);
  };
  const locate = (start: number, end: number): Range => ({
    start: lines.position(toOffset(start)),
    // The end is exclusive: locate the last character, then step past it.
    end: end > start ? advance(lines.position(toOffset(end - 1))) : lines.position(toOffset(start)),
  });
  return { raw, origin, file: input.path, range: locate(0, raw.length), locate, ...extra };
}

function advance(p: Range['start']): Range['start'] {
  return { line: p.line, column: p.column + 1, offset: p.offset + 1 };
}

// ---------------------------------------------------------------------------------------------
// Inline code

/** For every inline code node: the plain text of its block and where the node starts in it. */
function inlineContexts(markdown: ParsedMarkdown): Map<Nodes, { text: string; index: number }> {
  const result = new Map<Nodes, { text: string; index: number }>();
  walk(markdown.tree, (node) => {
    if (node.type !== 'paragraph' && node.type !== 'heading' && node.type !== 'tableCell') return;
    let text = '';
    const pending: InlineCode[] = [];
    const visit = (child: PhrasingContent): void => {
      if (child.type === 'inlineCode') {
        pending.push(child);
        result.set(child, { text: '', index: text.length });
        text += child.value;
      } else if (child.type === 'text') {
        text += child.value;
      } else if (child.type === 'break') {
        text += ' ';
      } else if ('children' in child) {
        for (const grandchild of child.children) visit(grandchild);
      }
    };
    for (const child of node.children) visit(child);
    for (const code of pending) {
      const entry = result.get(code);
      if (entry) entry.text = text;
    }
  });
  return result;
}

function pushInlineCode(
  out: Candidate[],
  input: ExtractInput,
  lines: LineMap,
  node: InlineCode,
  context: { text: string; index: number } | undefined,
): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || node.value.trim() === '') return;

  // Skip the opening backticks and, per CommonMark, one stripped padding space.
  const source = input.content.slice(start, end);
  const ticks = /^`+/.exec(source)?.[0].length ?? 1;
  const inner = source.slice(ticks, source.length - ticks);
  const padded = inner.length >= 2 && /^[ \n]/.test(inner) && /[ \n]$/.test(inner);
  const valueOffset = start + ticks + (padded ? 1 : 0);

  out.push(
    candidate(input, lines, node.value, 'inlineCode', [{ rawStart: 0, offset: valueOffset }], {
      ...(context ? { context } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Code blocks

interface CodeLine {
  text: string;
  /** File offset of `text[0]`. */
  offset: number;
}

/** The block's value split into lines, each mapped to its offset in the file. */
function codeLines(lines: LineMap, node: Code): CodeLine[] {
  const start = node.position?.start;
  if (!start || node.value === '') return [];
  const firstLineText = lines.lineText(start.line).trimStart();
  const fenced = firstLineText.startsWith('```') || firstLineText.startsWith('~~~');
  const firstLine = fenced ? start.line + 1 : start.line;

  return node.value.split('\n').map((text, i) => {
    const sourceLine = lines.lineText(firstLine + i);
    // Container indentation (lists, quotes) is stripped from the value, so align on the end.
    let column = sourceLine.endsWith(text)
      ? sourceLine.length - text.length
      : sourceLine.indexOf(text);
    if (column < 0) column = 0;
    return { text, offset: lines.lineStart(firstLine + i) + column };
  });
}

function pushCodeBlock(out: Candidate[], input: ExtractInput, lines: LineMap, node: Code): void {
  const lang = node.lang?.toLowerCase() ?? '';
  if (lang === '' || SHELL_LANGS.has(lang)) {
    pushShellLines(out, input, lines, node, lang);
  } else if (IMPORT_LANGS.has(lang)) {
    pushImports(out, input, lines, node, lang);
  }
}

function pushShellLines(
  out: Candidate[],
  input: ExtractInput,
  lines: LineMap,
  node: Code,
  lang: string,
): void {
  const promptRequired = PROMPT_REQUIRED_LANGS.has(lang);
  const all = codeLines(lines, node);

  let i = 0;
  let heredocEnd: string | null = null;
  while (i < all.length) {
    const first = all[i] as CodeLine;
    i++;
    // Skip heredoc bodies: they're data, not commands.
    if (heredocEnd !== null) {
      if (first.text.trim() === heredocEnd) heredocEnd = null;
      continue;
    }
    heredocEnd = HEREDOC.exec(first.text)?.[1] ?? null;
    const prompt = PROMPT.exec(first.text);
    if (promptRequired && !prompt) continue;

    let part: CodeLine = prompt
      ? { text: first.text.slice(prompt[0].length), offset: first.offset + prompt[0].length }
      : first;
    part = trimLeading(part);
    if (part.text === '' || part.text.startsWith('#')) continue;

    // Join `\` continuation lines into one logical command.
    let raw = '';
    const segments: Segment[] = [];
    for (;;) {
      const continued = /\\\s*$/.test(part.text);
      const text = continued ? part.text.replace(/\\\s*$/, '') : part.text;
      segments.push({ rawStart: raw.length, offset: part.offset });
      raw += text;
      if (!continued || i >= all.length) break;
      raw += ' ';
      const next = all[i] as CodeLine;
      i++;
      const ps2 = /^\s*>\s+/.exec(next.text);
      part = trimLeading(
        ps2 ? { text: next.text.slice(ps2[0].length), offset: next.offset + ps2[0].length } : next,
      );
    }

    out.push(candidate(input, lines, raw.trimEnd(), 'codeBlock', segments, { lang }));
  }
}

function trimLeading(line: CodeLine): CodeLine {
  const text = line.text.trimStart();
  return { text, offset: line.offset + (line.text.length - text.length) };
}

/** `import x from 'pkg'`, `export * from 'pkg'`, `import 'pkg'`, `require('pkg')`, `vi.mock('pkg')`. */
const IMPORT_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/dgm,
  /(?:^|[\s;])import\s*(['"])([^'"\n]+)\1/dgm,
  /\b(?:require|import|require\.resolve)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/dg,
  /\b(?:vi|jest)\.(?:mock|doMock|requireActual|importActual)\s*\(\s*(['"])([^'"\n]+)\1/dg,
];

function pushImports(
  out: Candidate[],
  input: ExtractInput,
  lines: LineMap,
  node: Code,
  lang: string,
): void {
  const all = codeLines(lines, node);
  // Value index → file offset, via the start index of each line in the value.
  const lineStarts: number[] = [];
  let index = 0;
  for (const line of all) {
    lineStarts.push(index);
    index += line.text.length + 1;
  }
  const toOffset = (valueIndex: number): number => {
    let lineNo = 0;
    while (lineNo + 1 < lineStarts.length && (lineStarts[lineNo + 1] as number) <= valueIndex)
      lineNo++;
    return (all[lineNo] as CodeLine).offset + (valueIndex - (lineStarts[lineNo] as number));
  };

  const seen = new Set<number>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of node.value.matchAll(pattern)) {
      const [start] = match.indices?.[2] ?? [];
      const specifier = match[2];
      if (start === undefined || specifier === undefined || seen.has(start)) continue;
      seen.add(start);
      out.push(
        candidate(input, lines, specifier, 'import', [{ rawStart: 0, offset: toOffset(start) }], {
          lang,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Links

function pushLink(
  out: Candidate[],
  input: ExtractInput,
  lines: LineMap,
  node: Link | Image | Definition,
): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const url = node.url;
  if (start === undefined || end === undefined || url === '' || url.startsWith('#')) return;

  const source = input.content.slice(start, end);
  // Look after the link text so `[src/a.ts](src/a.ts)` resolves to the destination.
  const after = node.type === 'definition' ? source.indexOf(']:') : source.lastIndexOf('](');
  const at = source.indexOf(url, Math.max(0, after));
  const offset = at >= 0 ? start + at : start;
  out.push(candidate(input, lines, url, 'link', [{ rawStart: 0, offset }]));
}

// ---------------------------------------------------------------------------------------------
// Frontmatter

function pushFrontmatterGlobs(out: Candidate[], input: ExtractInput, lines: LineMap): void {
  const fm = input.markdown.frontmatter;
  if (!fm?.data) return;
  const contentOffset = input.content.indexOf('\n', fm.range.start.offset) + 1;

  for (const key of GLOB_KEYS) {
    const value = fm.data[key];
    const globs = (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === 'string')
      // Cursor writes several globs as one comma-separated string.
      .flatMap((v) => splitGlobList(v));

    let searchFrom = 0;
    for (const glob of globs) {
      const at = fm.raw.indexOf(glob, searchFrom);
      if (at >= 0) searchFrom = at + glob.length;
      const offset = at >= 0 ? contentOffset + at : fm.range.start.offset;
      out.push(
        candidate(input, lines, glob, 'frontmatter', [{ rawStart: 0, offset }], {
          frontmatterKey: key,
        }),
      );
    }
  }
}

/** Splits `a, b,{c,d}` on commas that are not inside braces. */
export function splitGlobList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}
