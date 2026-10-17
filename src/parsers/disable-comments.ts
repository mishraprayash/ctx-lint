import type { Root } from 'mdast';
import type { Range } from '../core/types.js';
import { rangeOf, walk } from './markdown.js';

// Inline controls (PLAN.md §4.3), written as HTML comments so agents ignore them:
//
//   <!-- ctx-lint-disable-next-line path-exists -->
//   <!-- ctx-lint-disable-line -->                         (same line, e.g. at the end of a bullet)
//   <!-- ctx-lint-disable dependency-installed, path-exists -->  …  <!-- ctx-lint-enable -->
//   <!-- ctx-lint-disable path-exists -- generated at build time -->   (text after " -- " is a reason)
//
// `enable` without rules ends every open region; `enable <rule>` ends only regions opened for
// exactly that rule.

export type DirectiveKind = 'disable' | 'enable' | 'disable-line' | 'disable-next-line';

export interface DisableDirective {
  kind: DirectiveKind;
  /** Rule ids, or `null` for all rules. */
  rules: string[] | null;
  range: Range;
}

const DIRECTIVE =
  /<!--\s*ctx-lint-(disable-next-line|disable-line|disable|enable)(?=[\s-])([\s\S]*?)-->/g;

/** Finds every ctx-lint directive in the document's HTML comments. */
export function collectDirectives(tree: Root): DisableDirective[] {
  const directives: DisableDirective[] = [];
  walk(tree, (node) => {
    if (node.type !== 'html') return;
    const nodeRange = rangeOf(node);
    if (!nodeRange) return;
    for (const match of node.value.matchAll(DIRECTIVE)) {
      const start = offsetToPosition(node.value, match.index, nodeRange);
      const end = offsetToPosition(node.value, match.index + match[0].length, nodeRange);
      directives.push({
        kind: match[1] as DirectiveKind,
        rules: parseRuleList(match[2] ?? ''),
        range: { start, end },
      });
    }
  });
  return directives.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

function parseRuleList(text: string): string[] | null {
  const withoutReason = text.split(/(?:^|\s)--(?:\s|$)/)[0] ?? '';
  const rules = withoutReason.split(/[\s,]+/).filter((rule) => rule !== '');
  return rules.length > 0 ? rules : null;
}

function offsetToPosition(text: string, index: number, nodeRange: Range): Range['start'] {
  const before = text.slice(0, index);
  const newlines = before.split('\n').length - 1;
  const column = newlines === 0 ? nodeRange.start.column + index : index - before.lastIndexOf('\n');
  return {
    line: nodeRange.start.line + newlines,
    column,
    offset: nodeRange.start.offset + index,
  };
}

interface Region {
  rules: string[] | null;
  fromLine: number;
  toLine: number;
  directive: DisableDirective;
}

/** Answers "is rule X suppressed on line N?" and tracks which directives were ever used. */
export class Suppressions {
  private readonly regions: Region[] = [];
  private readonly used = new Set<DisableDirective>();

  constructor(directives: readonly DisableDirective[]) {
    const open: Region[] = [];
    for (const directive of directives) {
      const { start, end } = directive.range;
      switch (directive.kind) {
        case 'disable-line':
          this.regions.push({
            rules: directive.rules,
            fromLine: start.line,
            toLine: end.line,
            directive,
          });
          break;
        case 'disable-next-line':
          this.regions.push({
            rules: directive.rules,
            fromLine: end.line + 1,
            toLine: end.line + 1,
            directive,
          });
          break;
        case 'disable': {
          const region = {
            rules: directive.rules,
            fromLine: start.line,
            toLine: Number.POSITIVE_INFINITY,
            directive,
          };
          open.push(region);
          this.regions.push(region);
          break;
        }
        case 'enable':
          for (let i = open.length - 1; i >= 0; i--) {
            const region = open[i] as Region;
            if (directive.rules === null || sameRules(region.rules, directive.rules)) {
              region.toLine = end.line;
              open.splice(i, 1);
            }
          }
          break;
      }
    }
  }

  static none(): Suppressions {
    return new Suppressions([]);
  }

  /** Whether `ruleId` is disabled on `line`. Marks the matching directive(s) as used. */
  isSuppressed(ruleId: string, line: number): boolean {
    let suppressed = false;
    for (const region of this.regions) {
      if (line < region.fromLine || line > region.toLine) continue;
      if (region.rules === null || region.rules.includes(ruleId)) {
        this.used.add(region.directive);
        suppressed = true;
      }
    }
    return suppressed;
  }

  /** Disable directives that never suppressed anything (for the `unused-disable` rule). */
  unused(): DisableDirective[] {
    return this.regions.map((r) => r.directive).filter((d) => !this.used.has(d));
  }
}

function sameRules(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((rule) => b.includes(rule));
}
