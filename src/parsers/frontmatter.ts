import { type Document, isAlias, parseDocument, visit } from 'yaml';
import type { Position, Range } from '../core/types.js';

export interface FrontmatterError {
  message: string;
  /** Position in the markdown file (not in the YAML snippet). */
  position: Position;
}

export interface Frontmatter {
  /** The YAML text between the `---` fences. */
  raw: string;
  /** Parsed mapping, or `null` when the YAML is invalid or not a mapping. */
  data: Record<string, unknown> | null;
  /** Range of the whole block, including the fences. */
  range: Range;
  error?: FrontmatterError;
}

/**
 * Parses frontmatter YAML. Errors are reported, never thrown, so `check` can turn them into
 * diagnostics (`frontmatter-valid`).
 *
 * @param contentOffset file offset where the YAML text starts (just after the opening fence).
 * @param lenient also accept flat `key: value` lines that aren't valid YAML, as Cursor does
 *   for `.mdc` files (`globs: *.ts, src/`, the form Cursor's own docs and editor write).
 */
export function parseFrontmatter(
  raw: string,
  range: Range,
  contentOffset: number,
  lenient = false,
): Frontmatter {
  const strict = parseStrict(raw, range, contentOffset);
  if (!strict.error || !lenient) return strict;
  const flat = parseFlat(raw);
  return flat ? { raw, data: flat, range } : strict;
}

/**
 * Flat `key: value` lines, values kept as strings (booleans aside). `null` when any line isn't
 * one, so real YAML mistakes (bad indentation, lists) are still reported.
 */
function parseFlat(raw: string): Record<string, unknown> | null {
  const data: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!match) return null;
    const [, key, value] = match as unknown as [string, string, string];
    if (key in data) return null;
    const unquoted = /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
    data[key] =
      value === 'true' ? true : value === 'false' ? false : value === '' ? null : unquoted;
  }
  return data;
}

function parseStrict(raw: string, range: Range, contentOffset: number): Frontmatter {
  // The YAML starts on the line after the opening `---`.
  const firstLine = range.start.line + 1;
  const doc = parseDocument(raw, { prettyErrors: false, uniqueKeys: true });

  const yamlError = doc.errors[0];
  if (yamlError) {
    const pos = yamlError.linePos?.[0];
    return {
      raw,
      data: null,
      range,
      error: {
        message: firstSentence(yamlError.message),
        position: {
          line: firstLine + (pos ? pos.line - 1 : 0),
          column: pos?.col ?? 1,
          offset: contentOffset + (yamlError.pos[0] ?? 0),
        },
      },
    };
  }

  let data: unknown;
  try {
    data = doc.toJS() ?? {};
  } catch (error) {
    // `toJS()` throws (rather than reporting) for unresolved aliases. A leading `*` makes YAML
    // read a value as an alias, a common mistake with unquoted globs like `globs: *.ts`.
    const offset = unresolvedAliasOffset(doc) ?? 0;
    const before = raw.slice(0, offset);
    const line = before.split('\n').length;
    return {
      raw,
      data: null,
      range,
      error: {
        message: `${error instanceof Error ? error.message : String(error)}. Quote values that start with "*", e.g. globs: "*.ts".`,
        position: {
          line: firstLine + line - 1,
          column: offset - before.lastIndexOf('\n'),
          offset: contentOffset + offset,
        },
      },
    };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      raw,
      data: null,
      range,
      error: {
        message: 'Frontmatter must be a YAML mapping (key: value pairs).',
        position: { line: firstLine, column: 1, offset: contentOffset },
      },
    };
  }

  return { raw, data: data as Record<string, unknown>, range };
}

function unresolvedAliasOffset(doc: Document): number | undefined {
  let offset: number | undefined;
  visit(doc, {
    Alias(_, node) {
      if (isAlias(node) && node.resolve(doc) === undefined) {
        offset = node.range?.[0];
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return offset;
}

function firstSentence(message: string): string {
  return message.split('\n')[0]?.replace(/ at line \d+, column \d+:?$/, '') ?? message;
}
