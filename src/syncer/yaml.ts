// A tiny, predictable frontmatter writer. Agents' frontmatter parsers vary (Cursor's isn't strict
// YAML), so we write the plainest valid YAML: plain scalars where safe, double quotes otherwise.

export type FrontmatterValue = string | boolean | number | null | readonly string[];

/**
 * `---\n…\n---\n` with keys in the given order. `undefined` values are skipped; `null` writes
 * an empty value (`key:`). Keys in `quote` are always double-quoted.
 */
export function renderFrontmatter(
  entries: readonly [string, FrontmatterValue | undefined][],
  options: { quote?: ReadonlySet<string> } = {},
): string {
  const lines = ['---'];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
    } else {
      const quote = options.quote?.has(key) === true;
      lines.push(
        value === null
          ? `${key}:`
          : `${key}: ${yamlScalar(value as string | boolean | number, { quote })}`,
      );
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** A YAML scalar: plain when unambiguous, otherwise a double-quoted (JSON) string. */
export function yamlScalar(
  value: string | boolean | number,
  options: { quote?: boolean } = {},
): string {
  if (typeof value !== 'string') return String(value);
  if (options.quote || !isPlainSafe(value)) return JSON.stringify(value);
  return value;
}

function isPlainSafe(value: string): boolean {
  if (value === '' || value !== value.trim()) return false;
  // Indicators that can't start a plain scalar: `*` alias, `&` anchor, `!` tag, quotes, …
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
  if (/: |\s#|:$|\n/.test(value)) return false;
  // Would be read as another type.
  if (/^(?:true|false|yes|no|on|off|null|~|[-+]?\d[\d_.e+-]*)$/i.test(value)) return false;
  return true;
}
