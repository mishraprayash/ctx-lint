import { describe, expect, it } from 'vitest';
import { collectDirectives, Suppressions } from '../../../src/parsers/disable-comments.js';
import { parseMarkdown, walk } from '../../../src/parsers/markdown.js';

describe('parseMarkdown', () => {
  it('parses GFM with exact positions', () => {
    const { tree, frontmatter } = parseMarkdown(
      '# Title\n\n| a | b |\n|---|---|\n| `src/x.ts` | y |\n',
    );
    expect(frontmatter).toBeNull();
    const codes: { value: string; line: number; column: number }[] = [];
    walk(tree, (node) => {
      if (node.type === 'inlineCode' && node.position) {
        codes.push({ value: node.value, ...node.position.start });
      }
    });
    expect(codes).toEqual([{ value: 'src/x.ts', line: 5, column: 3, offset: expect.any(Number) }]);
  });

  it('extracts frontmatter as data', () => {
    const { frontmatter } = parseMarkdown(
      '---\ndescription: API rules\nglobs: ["src/api/**"]\nalwaysApply: false\n---\n\nBody\n',
    );
    expect(frontmatter?.data).toEqual({
      description: 'API rules',
      globs: ['src/api/**'],
      alwaysApply: false,
    });
    expect(frontmatter?.range.start.line).toBe(1);
    expect(frontmatter?.range.end.line).toBe(5);
    expect(frontmatter?.error).toBeUndefined();
  });

  it('reports YAML errors at their position in the markdown file', () => {
    // An unquoted leading `*` is a YAML alias, a common mistake in Cursor rule globs.
    const { frontmatter } = parseMarkdown('---\ndescription: x\nglobs: *.ts\n---\n');
    expect(frontmatter?.data).toBeNull();
    expect(frontmatter?.error?.position).toMatchObject({ line: 3, column: 8 });
    expect(frontmatter?.error?.message).toMatch(/Quote values/);
  });

  it('rejects frontmatter that is not a mapping', () => {
    const { frontmatter } = parseMarkdown('---\n- a\n- b\n---\n');
    expect(frontmatter?.error?.message).toMatch(/mapping/);
  });

  it('treats empty frontmatter as an empty mapping', () => {
    expect(parseMarkdown('---\n---\n').frontmatter?.data).toEqual({});
  });
});

describe('disable directives', () => {
  const directivesOf = (md: string) => collectDirectives(parseMarkdown(md).tree);

  it('parses kinds, rule lists and reasons', () => {
    const directives = directivesOf(
      [
        '<!-- ctx-lint-disable-next-line path-exists -->',
        '- `src/gone.ts`',
        '',
        '<!-- ctx-lint-disable path-exists, script-exists -- generated at build time -->',
        '',
        '<!-- ctx-lint-enable -->',
      ].join('\n'),
    );
    expect(directives.map((d) => [d.kind, d.rules, d.range.start.line])).toEqual([
      ['disable-next-line', ['path-exists'], 1],
      ['disable', ['path-exists', 'script-exists'], 4],
      ['enable', null, 6],
    ]);
  });

  it('finds inline comments inside paragraphs and ignores look-alikes', () => {
    const directives = directivesOf(
      'Run `make x` <!-- ctx-lint-disable-line --> now.\n\n<!-- ctx-lint-disabled -->\n\n```md\n<!-- ctx-lint-disable -->\n```\n',
    );
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({ kind: 'disable-line', rules: null });
    expect(directives[0]?.range.start).toMatchObject({ line: 1, column: 14 });
  });

  it('suppresses next-line, same-line and region directives', () => {
    const s = new Suppressions(
      directivesOf(
        [
          '<!-- ctx-lint-disable-next-line path-exists -->', // 1
          'line two', // 2
          'line three <!-- ctx-lint-disable-line -->', // 3
          '', // 4
          '<!-- ctx-lint-disable script-exists -->', // 5
          'six', // 6
          '<!-- ctx-lint-enable script-exists -->', // 7
          'eight', // 8
        ].join('\n'),
      ),
    );
    expect(s.isSuppressed('path-exists', 2)).toBe(true);
    expect(s.isSuppressed('script-exists', 2)).toBe(false);
    expect(s.isSuppressed('anything', 3)).toBe(true);
    expect(s.isSuppressed('script-exists', 6)).toBe(true);
    expect(s.isSuppressed('script-exists', 8)).toBe(false);
  });

  it('keeps an unclosed region open until the end of the file', () => {
    const s = new Suppressions(directivesOf(`<!-- ctx-lint-disable -->\n\n${'x\n'.repeat(50)}`));
    expect(s.isSuppressed('path-exists', 50)).toBe(true);
  });

  it('reports directives that suppressed nothing', () => {
    const s = new Suppressions(
      directivesOf(
        '<!-- ctx-lint-disable-next-line path-exists -->\nok\n\n<!-- ctx-lint-disable-next-line glob-matches -->\nok\n',
      ),
    );
    s.isSuppressed('path-exists', 2);
    expect(s.unused().map((d) => d.rules)).toEqual([['glob-matches']]);
  });
});

describe('frontmatter with CRLF line endings', () => {
  it('reports the right offset', () => {
    const md = '---\r\ndescription: x\r\nglobs: *.ts\r\n---\r\n';
    const error = parseMarkdown(md).frontmatter?.error;
    expect(error?.position.line).toBe(3);
    expect(md.slice(error?.position.offset)).toMatch(/^\*\.ts/);
  });
});
