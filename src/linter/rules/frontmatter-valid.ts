import { LineMap } from '../../core/line-map.js';
import type { Range } from '../../core/types.js';
import { frontmatterSpecFor } from '../../targets/frontmatter.js';
import type { LintRule, RuleContext } from '../rule.js';
import { closest, orList } from '../suggest.js';
import { pointRange } from './util.js';

export const frontmatterValid: LintRule = {
  id: 'frontmatter-valid',
  meta: {
    description:
      'Frontmatter is valid YAML and uses the keys and types the target format expects (Cursor, Copilot, Windsurf, source rules).',
    defaultSeverity: 'error',
  },
  file(file, ctx) {
    const fm = file.markdown.frontmatter;
    if (!fm) return;
    if (fm.error) {
      ctx.report({
        message: `Invalid frontmatter: ${fm.error.message}`,
        range: pointRange(fm.error.position),
      });
      return;
    }
    const data = fm.data ?? {};
    const spec = frontmatterSpecFor(file);
    if (!spec) return;

    const known = Object.keys(spec.fields);
    for (const [key, value] of Object.entries(data)) {
      const field = spec.fields[key];
      if (!field) {
        const near = closest(key, known);
        ctx.report({
          message: `Unknown frontmatter key "${key}" for ${spec.label}.${near.length > 0 ? ` Did you mean ${orList(near)}?` : ` Known keys: ${known.join(', ')}.`}`,
          range: keyRange(ctx, key),
          downgrade: true,
        });
      } else if (!field.schema.safeParse(value).success) {
        ctx.report({ message: `"${key}" must be ${field.expected}.`, range: keyRange(ctx, key) });
      }
    }

    // Source rules that aren't always applied need a way to be selected (PLAN.md §6.1).
    if (file.kind === 'source' && data.alwaysApply === false && !data.globs && !data.description) {
      ctx.report({
        message:
          'A rule with `alwaysApply: false` needs `globs` or a `description`, or no agent will ever load it.',
        range: keyRange(ctx, 'alwaysApply'),
      });
    }
  },
};

/** Range of `key:` inside the frontmatter, falling back to the opening fence. */
function keyRange(ctx: RuleContext, key: string): Range {
  const fm = ctx.file.markdown.frontmatter;
  const lines = new LineMap(ctx.file.content);
  if (!fm) return pointRange(lines.position(0));
  const match = new RegExp(
    `^[ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:`,
    'm',
  ).exec(fm.raw);
  if (!match) return pointRange(fm.range.start);
  const contentOffset = ctx.file.content.indexOf('\n', fm.range.start.offset) + 1;
  const start = contentOffset + match.index + (match[0].length - match[0].trimStart().length);
  return { start: lines.position(start), end: lines.position(start + key.length) };
}
