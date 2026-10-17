import type { Range } from '../../core/types.js';
import type { RuleContext } from '../rule.js';

/** The exact source text of a range in the file being linted. */
export function sourceText(ctx: RuleContext, range: Range): string {
  return ctx.file.content.slice(range.start.offset, range.end.offset);
}

/** A one-character range at a position (for problems without a natural span). */
export function pointRange(position: Range['start']): Range {
  return {
    start: position,
    end: { ...position, column: position.column + 1, offset: position.offset + 1 },
  };
}
