import { z } from 'zod';
import { AGENT_IDS } from '../core/types.js';

// What each rule-file format accepts in its frontmatter. `check` validates against these
// (`frontmatter-valid`) and `sync` will generate files that satisfy them.

export interface FieldSpec {
  schema: z.ZodType;
  /** Human description of the expected type, used in messages. */
  expected: string;
}

export interface FrontmatterSpec {
  /** Name of the format, for messages: "Cursor rules". */
  label: string;
  fields: Readonly<Record<string, FieldSpec>>;
}

const text: FieldSpec = { schema: z.string(), expected: 'a string' };
const optionalText: FieldSpec = { schema: z.string().nullable(), expected: 'a string' };
const globList: FieldSpec = {
  schema: z.union([z.string(), z.array(z.string())]).nullable(),
  expected: 'a string or a list of strings',
};
const bool: FieldSpec = { schema: z.boolean(), expected: 'true or false (unquoted)' };

export const CURSOR_FRONTMATTER: FrontmatterSpec = {
  label: 'Cursor rules',
  fields: { description: optionalText, globs: globList, alwaysApply: bool },
};

export const COPILOT_FRONTMATTER: FrontmatterSpec = {
  label: 'Copilot instruction files',
  fields: { applyTo: globList, description: optionalText, excludeAgent: optionalText },
};

export const WINDSURF_FRONTMATTER: FrontmatterSpec = {
  label: 'Windsurf rules',
  fields: {
    trigger: {
      schema: z.enum(['always_on', 'glob', 'model_decision', 'manual']),
      expected: 'one of always_on, glob, model_decision, manual',
    },
    globs: globList,
    description: optionalText,
  },
};

export const SOURCE_FRONTMATTER: FrontmatterSpec = {
  label: 'ctx-lint source rules',
  fields: {
    description: text,
    globs: globList,
    alwaysApply: bool,
    targets: {
      schema: z.array(z.enum(AGENT_IDS)),
      expected: `a list of targets (${AGENT_IDS.join(', ')})`,
    },
    priority: { schema: z.number(), expected: 'a number' },
  },
};

/** The frontmatter format of a file, or `null` when it has none to validate. */
export function frontmatterSpecFor(file: { path: string; kind: string }): FrontmatterSpec | null {
  if (file.kind === 'source') return SOURCE_FRONTMATTER;
  if (file.path.endsWith('.mdc') && /(^|\/)\.cursor\/rules\//.test(file.path))
    return CURSOR_FRONTMATTER;
  if (file.path.endsWith('.instructions.md') && file.path.startsWith('.github/instructions/')) {
    return COPILOT_FRONTMATTER;
  }
  if (/(^|\/)\.windsurf\/rules\//.test(file.path)) return WINDSURF_FRONTMATTER;
  return null;
}
