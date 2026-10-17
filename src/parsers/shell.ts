// A deliberately small shell-line tokenizer. It understands just enough POSIX shell to find the
// commands in a line like `cd web && CI=1 pnpm --filter app test 2>&1 | tee log`, and keeps
// the offset of every word so diagnostics can point at it. It doesn't expand anything.

export interface Word {
  /** The word with quotes and escapes removed. */
  value: string;
  /** Offsets in the input line, including any quotes: [start, end). */
  start: number;
  end: number;
  /** Contains `$VAR`, `${…}`, `$(…)` or backticks, so the real value is unknown. */
  dynamic: boolean;
}

export interface SimpleCommand {
  words: Word[];
}

const SEPARATOR_CHARS = new Set([';', '&', '|', '(', ')', '\n']);

/** Splits a shell line into simple commands (pipelines and lists are flattened). */
export function parseShellLine(line: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let words: Word[] = [];
  let word: Word | null = null;
  let dropNextWord = false;
  let i = 0;

  const finishWord = (): void => {
    if (!word) return;
    if (dropNextWord) dropNextWord = false;
    else words.push(word);
    word = null;
  };
  const finishCommand = (): void => {
    finishWord();
    if (words.length > 0) commands.push({ words });
    words = [];
  };
  const current = (): Word => {
    word ??= { value: '', start: i, end: i, dynamic: false };
    return word;
  };

  while (i < line.length) {
    const ch = line[i] as string;

    if (ch === ' ' || ch === '\t') {
      finishWord();
      i++;
      continue;
    }

    if (ch === '#' && word === null) break; // Comment to the end of the line.

    if (SEPARATOR_CHARS.has(ch)) {
      // `&>` and `|&` are redirections/pipes, handled the same as their parts here.
      if (ch === '&' && line[i + 1] === '>') {
        i = consumeRedirect(line, i + 1, (dropTarget) => {
          finishWord();
          dropNextWord = dropTarget;
        });
        continue;
      }
      finishCommand();
      i++;
      continue;
    }

    if (ch === '<' || ch === '>') {
      // A number right before the operator is a file descriptor (`2>`), not a word.
      // (`word` is mutated inside closures, so TypeScript can't track it here.)
      const pending = word as Word | null;
      if (pending !== null && /^\d+$/.test(pending.value) && pending.end === i) word = null;
      if (line.startsWith('<<', i) && !line.startsWith('<<<', i)) {
        finishCommand(); // Heredoc: the body isn't on this line; nothing after it matters.
        return commands;
      }
      i = consumeRedirect(line, i, (dropTarget) => {
        finishWord();
        dropNextWord = dropTarget;
      });
      continue;
    }

    const w = current();
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      const end = close === -1 ? line.length : close;
      w.value += line.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '"') {
      i = readDoubleQuoted(line, i + 1, w);
    } else if (ch === '\\') {
      w.value += line[i + 1] ?? '';
      i += 2;
    } else if (ch === '$' || ch === '`') {
      const end = skipExpansion(line, i);
      w.value += line.slice(i, end);
      w.dynamic = true;
      i = end;
    } else {
      w.value += ch;
      i++;
    }
    w.end = Math.min(i, line.length);
  }

  finishCommand();
  return commands;
}

/** Consumes a redirection operator starting at `i`; reports whether a target word follows. */
function consumeRedirect(line: string, i: number, done: (dropTarget: boolean) => void): number {
  let j = i;
  while (j < line.length && (line[j] === '<' || line[j] === '>')) j++;
  // `>&2`, `2>&1`: duplicating a descriptor, no file target.
  if (line[j] === '&' && /\d|-/.test(line[j + 1] ?? '')) {
    j += 2;
    done(false);
    return j;
  }
  done(true);
  return j;
}

function readDoubleQuoted(line: string, i: number, w: Word): number {
  let j = i;
  while (j < line.length && line[j] !== '"') {
    const ch = line[j] as string;
    if (ch === '\\' && j + 1 < line.length) {
      w.value += line[j + 1];
      j += 2;
    } else if (ch === '$' || ch === '`') {
      const end = skipExpansion(line, j);
      w.value += line.slice(j, end);
      w.dynamic = true;
      j = end;
    } else {
      w.value += ch;
      j++;
    }
  }
  return j + 1;
}

/** End offset of a `$VAR`, `${…}`, `$(…)` or `` `…` `` expansion starting at `i`. */
function skipExpansion(line: string, i: number): number {
  if (line[i] === '`') {
    const close = line.indexOf('`', i + 1);
    return close === -1 ? line.length : close + 1;
  }
  const next = line[i + 1];
  if (next === '(' || next === '{') {
    const open = next;
    const close = open === '(' ? ')' : '}';
    let depth = 0;
    for (let j = i + 1; j < line.length; j++) {
      if (line[j] === open) depth++;
      else if (line[j] === close && --depth === 0) return j + 1;
    }
    return line.length;
  }
  const name = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(line.slice(i + 1));
  return i + 1 + (name?.[0].length ?? 0);
}

// ---------------------------------------------------------------------------------------------

/** Commands that run the rest of the line as another command. */
const WRAPPERS = new Set([
  'sudo',
  'time',
  'nohup',
  'exec',
  'command',
  'env',
  'cross-env',
  'corepack',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Drops leading `VAR=value` assignments and wrappers (`sudo`, `env`, `cross-env`,
 * `dotenv -- …`, `corepack …`) so the first word is the real command.
 */
export function stripCommandPrefix(words: readonly Word[]): Word[] {
  let rest = [...words];
  for (;;) {
    const first = rest[0];
    if (!first) return rest;
    if (ASSIGNMENT.test(first.value)) {
      rest = rest.slice(1);
    } else if (WRAPPERS.has(first.value)) {
      rest = rest.slice(1);
      // Wrapper flags such as `env -i` or `sudo -E`; `sudo -u user` takes a value.
      while (rest[0]?.value.startsWith('-')) {
        const flag = rest[0].value;
        rest = rest.slice(flag === '-u' || flag === '--user' ? 2 : 1);
      }
    } else if (first.value === 'dotenv' || first.value === 'dotenvx') {
      const dashes = rest.findIndex((w) => w.value === '--');
      if (dashes === -1) return [];
      rest = rest.slice(dashes + 1);
    } else {
      return rest;
    }
  }
}
