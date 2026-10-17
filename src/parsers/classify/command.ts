import { normalizeRel } from '../../core/paths.js';
import type {
  BinReference,
  Candidate,
  Classification,
  PackageManager,
  ScriptReference,
  TargetReference,
} from '../../core/references.js';
import type { Confidence } from '../../core/types.js';
import { parseShellLine, stripCommandPrefix, type Word } from '../shell.js';
import type { ClassifyContext } from './context.js';
import { classifyPathToken } from './path.js';
import {
  BUN_BUILTINS,
  INTERPRETERS,
  NPM_RUN_ALIASES,
  PNPM_BUILTINS,
  UNVERIFIABLE_TOOLS,
  YARN_BUILTINS,
} from './words.js';

// Shell command classification (PLAN.md §5.3 B). Every command in the line is looked at, so
// `cd web && pnpm build` yields a directory reference and a script reference.

/** Classifies every command in a shell line. Returns `[]` when nothing is recognized. */
export function classifyShell(candidate: Candidate, ctx: ClassifyContext): Classification[] {
  const out: Classification[] = [];
  for (const { words } of parseShellLine(candidate.raw)) {
    const cmd = stripCommandPrefix(words);
    const head = cmd[0];
    if (!head || head.dynamic) continue;
    const emit = new Emitter(candidate, ctx, out);
    const args = cmd.slice(1);

    switch (head.value) {
      case 'npm':
        npm(args, emit);
        break;
      case 'pnpm':
        pnpm(args, emit);
        break;
      case 'yarn':
        yarn(args, emit);
        break;
      case 'bun':
        bun(args, emit);
        break;
      case 'npx':
        packageRunner(args, emit, 'npm');
        break;
      case 'pnpx':
        packageRunner(args, emit, 'pnpm');
        break;
      case 'bunx':
        packageRunner(args, emit, 'bun');
        break;
      case 'make':
      case 'gmake':
        make(args, emit);
        break;
      case 'just':
        just(args, emit);
        break;
      case 'node':
        node(args, emit);
        break;
      case 'cd':
        cd(args, emit);
        break;
      default:
        if (UNVERIFIABLE_TOOLS.has(head.value)) {
          out.push({ kind: 'ignored', reason: 'unverifiable-tool', candidate });
        } else if (INTERPRETERS.has(head.value)) {
          interpreter(head.value, args, emit);
        } else if (head.value.includes('/')) {
          // `./scripts/deploy.sh --prod`, `bin/dev`. Low-confidence heads (`a/b c`) are noise.
          emit.path(head, { skipLow: true });
        }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

class Emitter {
  constructor(
    private readonly candidate: Candidate,
    private readonly ctx: ClassifyContext,
    private readonly out: Classification[],
  ) {}

  private range(word: Word) {
    return this.candidate.locate(word.start, word.end);
  }

  script(
    tool: ScriptReference['tool'],
    word: Word | undefined,
    confidence: Confidence,
    extra: Extras<ScriptReference, 'workspace' | 'recursive' | 'dir' | 'ifPresent' | 'orBin'> = {},
  ): void {
    if (!word || word.dynamic || !isName(word.value)) return;
    this.out.push({
      kind: 'script',
      tool,
      name: word.value,
      confidence,
      candidate: this.candidate,
      range: this.range(word),
      ...definedOnly(extra),
    });
  }

  /**
   * `pnpm x` / `yarn x` / `bun x`: a script, or else a binary of that name. Names with a colon
   * (`test:e2e`) can only be scripts, so those are certain.
   */
  bareScript(
    tool: PackageManager,
    word: Word,
    extra: Extras<ScriptReference, 'workspace' | 'recursive' | 'dir' | 'ifPresent'> = {},
  ): void {
    if (word.value.includes(':')) this.script(tool, word, 'high', extra);
    else this.script(tool, word, 'medium', { ...extra, orBin: true });
  }

  target(
    tool: TargetReference['tool'],
    word: Word,
    extra: Extras<TargetReference, 'dir' | 'file'> = {},
  ): void {
    if (word.dynamic || !isName(word.value)) return;
    this.out.push({
      kind: 'target',
      tool,
      name: word.value,
      confidence: 'high',
      candidate: this.candidate,
      range: this.range(word),
      ...definedOnly(extra),
    });
  }

  bin(tool: BinReference['tool'], word: Word | undefined): void {
    if (!word || word.dynamic) return;
    const name = stripVersion(word.value);
    if (!isName(name) || name.startsWith('create-')) return; // Generators are run, not installed.
    this.out.push({
      kind: 'bin',
      tool,
      name,
      confidence: 'medium',
      candidate: this.candidate,
      range: this.range(word),
    });
  }

  /** Emits a path reference if the word looks like a path. Returns whether it did. */
  path(word: Word | undefined, options: { forceDir?: boolean; skipLow?: boolean } = {}): boolean {
    if (!word || word.dynamic) return false;
    const result = classifyPathToken(word.value, this.ctx, {
      origin: this.candidate.origin,
      ...(options.forceDir ? { forceDir: true } : {}),
    });
    if (result === null) return false;
    if (options.skipLow && 'path' in result && result.path.confidence === 'low') return false;
    if ('ignored' in result) {
      this.out.push({ kind: 'ignored', reason: result.ignored, candidate: this.candidate });
      return true;
    }
    this.out.push({
      kind: 'path',
      ...result.path,
      candidate: this.candidate,
      range: this.range(word),
    });
    return true;
  }
}

/** Optional fields that may also be passed as `undefined` (dropped by `definedOnly`). */
type Extras<T, K extends keyof T> = { [P in K]?: T[P] | undefined };

function definedOnly<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/** Script, target and bin names: no placeholders, no paths, no flags. */
function isName(value: string): boolean {
  return /^[\w@][\w@:./+-]*$/.test(value) && !/[<>{}$]/.test(value);
}

/** `pkg@1.2.3` → `pkg`, `@scope/pkg@latest` → `@scope/pkg`. */
function stripVersion(spec: string): string {
  const at = spec.indexOf('@', 1);
  return at === -1 ? spec : spec.slice(0, at);
}

// ---------------------------------------------------------------------------------------------
// Argument parsing

interface ParsedArgs {
  positionals: Word[];
  /** Flag → value word, or `true` for boolean flags. Flags are stored without `=value`. */
  flags: Map<string, Word | true>;
}

/**
 * Generic option parser: `--flag value`, `--flag=value`, `-Fvalue` (for known short value
 * flags) and boolean flags. Stops at `--`.
 */
function parseArgs(
  args: readonly Word[],
  valueFlags: ReadonlySet<string>,
  optionalNumeric: ReadonlySet<string> = new Set(),
): ParsedArgs {
  const positionals: Word[] = [];
  const flags = new Map<string, Word | true>();
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as Word;
    const v = word.value;
    if (v === '--') break;
    if (!v.startsWith('-') || v === '-') {
      positionals.push(word);
      continue;
    }
    const eq = v.indexOf('=');
    if (v.startsWith('--') && eq !== -1) {
      flags.set(v.slice(0, eq), { ...word, value: v.slice(eq + 1), start: word.start + eq + 1 });
      continue;
    }
    if (valueFlags.has(v)) {
      const next = args[i + 1];
      if (optionalNumeric.has(v) && !(next && /^\d+$/.test(next.value))) {
        flags.set(v, true);
        continue;
      }
      if (next) {
        flags.set(v, next);
        i++;
      }
      continue;
    }
    // `-Cdir`, `-Fweb`: a short value flag glued to its value.
    const short = v.slice(0, 2);
    if (!v.startsWith('--') && v.length > 2 && valueFlags.has(short)) {
      flags.set(short, { ...word, value: v.slice(2), start: word.start + 2 });
      continue;
    }
    flags.set(v, true);
  }
  return { positionals, flags };
}

function flagValue(parsed: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = parsed.flags.get(name);
    if (value !== undefined && value !== true && !value.dynamic) return value.value;
  }
  return undefined;
}

function hasFlag(parsed: ParsedArgs, ...names: string[]): boolean {
  return names.some((name) => parsed.flags.has(name));
}

// ---------------------------------------------------------------------------------------------
// Package managers

const NPM_VALUE_FLAGS = new Set([
  '-w',
  '--workspace',
  '--prefix',
  '--loglevel',
  '--registry',
  '--userconfig',
  '--cache',
  '-c',
  '--call',
]);

function npm(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(args, NPM_VALUE_FLAGS);
  const [sub, script] = parsed.positionals;
  if (!sub) return;
  const extra = {
    workspace: flagValue(parsed, '-w', '--workspace'),
    recursive: hasFlag(parsed, '--workspaces', '-ws') || undefined,
    dir: dirFlag(flagValue(parsed, '--prefix')),
    ifPresent: hasFlag(parsed, '--if-present') || undefined,
  };
  if (NPM_RUN_ALIASES.has(sub.value)) {
    emit.script('npm', script, 'high', extra);
  } else if (sub.value === 'test' || sub.value === 't' || sub.value === 'tst') {
    emit.script('npm', { ...sub, value: 'test' }, 'high', extra);
  } else if (sub.value === 'start' || sub.value === 'stop' || sub.value === 'restart') {
    // `npm start` falls back to `node server.js`; `npm restart` to stop + start.
    emit.script('npm', sub, sub.value === 'stop' ? 'high' : 'medium', extra);
  } else if (sub.value === 'exec' || sub.value === 'x') {
    if (!hasFlag(parsed, '-c', '--call', '--package', '-p', '--yes', '-y')) emit.bin('npm', script);
  }
}

const PNPM_VALUE_FLAGS = new Set([
  '--filter',
  '-F',
  '--filter-prod',
  '-C',
  '--dir',
  '--reporter',
  '--loglevel',
  '--workspace-concurrency',
  '--test-pattern',
  '--changed-files-ignore-pattern',
  '--resume-from',
]);

function pnpm(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(args, PNPM_VALUE_FLAGS);
  const [sub, next] = parsed.positionals;
  if (!sub) return;
  const extra = {
    workspace: flagValue(parsed, '--filter', '-F', '--filter-prod'),
    recursive: hasFlag(parsed, '-r', '--recursive') || undefined,
    dir: dirFlag(flagValue(parsed, '-C', '--dir')),
    ifPresent: hasFlag(parsed, '--if-present') || undefined,
  };
  if (sub.value === 'run' || sub.value === 'run-script') {
    emit.script('pnpm', next, 'high', extra);
  } else if (sub.value === 'test' || sub.value === 't' || sub.value === 'tst') {
    emit.script('pnpm', { ...sub, value: 'test' }, 'high', extra);
  } else if (sub.value === 'start') {
    emit.script('pnpm', sub, 'medium', extra);
  } else if (sub.value === 'exec') {
    emit.bin('pnpm', next);
  } else if (!PNPM_BUILTINS.has(sub.value)) {
    // pnpm runs a script by that name, or falls back to `pnpm exec`.
    emit.bareScript('pnpm', sub, extra);
  }
}

function yarn(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(args, new Set(['--cwd']));
  const positionals = parsed.positionals;
  const [sub] = positionals;
  if (!sub) return; // `yarn` alone installs.
  const dir = dirFlag(flagValue(parsed, '--cwd'));

  if (sub.value === 'workspace') {
    const [, workspace, inner, innerScript] = positionals;
    if (!workspace || workspace.dynamic || !inner) return;
    if (inner.value === 'run')
      emit.script('yarn', innerScript, 'high', { workspace: workspace.value, dir });
    else if (!YARN_BUILTINS.has(inner.value))
      emit.bareScript('yarn', inner, { workspace: workspace.value, dir });
    return;
  }
  if (sub.value === 'workspaces') {
    // `yarn workspaces run build` (classic), `yarn workspaces foreach -A run build` (berry).
    const run = positionals.findIndex((w) => w.value === 'run');
    if (run !== -1) emit.script('yarn', positionals[run + 1], 'high', { recursive: true, dir });
    return;
  }
  if (sub.value === 'run') {
    emit.script('yarn', positionals[1], 'high', { dir, orBin: true });
  } else if (sub.value === 'test') {
    emit.script('yarn', sub, 'high', { dir });
  } else if (sub.value === 'start') {
    emit.script('yarn', sub, 'medium', { dir });
  } else if (!YARN_BUILTINS.has(sub.value)) {
    emit.bareScript('yarn', sub, { dir });
  }
}

function bun(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(
    args,
    new Set(['--cwd', '--filter', '-F', '--config', '-c', '--env-file']),
  );
  const [sub, next] = parsed.positionals;
  if (!sub) return;
  const extra = {
    workspace: flagValue(parsed, '--filter', '-F'),
    dir: dirFlag(flagValue(parsed, '--cwd')),
  };
  if (sub.value === 'run') {
    if (!next) return;
    if (!emitFile(next, emit)) emit.script('bun', next, 'high', { ...extra, orBin: true });
  } else if (sub.value === 'x') {
    emit.bin('bun', next);
  } else if (!BUN_BUILTINS.has(sub.value)) {
    if (!emitFile(sub, emit)) emit.bareScript('bun', sub, extra);
  }
}

/** `bun run src/index.ts`: a file argument rather than a script name. */
function emitFile(word: Word, emit: Emitter): boolean {
  return /[/.]/.test(word.value) && !word.value.startsWith('-') && emit.path(word);
}

function packageRunner(args: readonly Word[], emit: Emitter, tool: PackageManager): void {
  const parsed = parseArgs(args, new Set(['-p', '--package', '-c', '--call']));
  // An explicit package or `--yes` means "download if needed": nothing has to be installed.
  if (hasFlag(parsed, '-p', '--package', '-c', '--call', '-y', '--yes')) return;
  const [bin] = parsed.positionals;
  if (bin && bin.value.indexOf('@', 1) !== -1) return; // `npx pkg@latest`: explicitly downloaded.
  emit.bin(tool, bin);
}

function node(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(
    args,
    new Set([
      '--run',
      '-e',
      '--eval',
      '-p',
      '--print',
      '-r',
      '--require',
      '--import',
      '--loader',
      '--env-file',
      '-C',
      '--conditions',
    ]),
  );
  const run = parsed.flags.get('--run');
  if (run !== undefined && run !== true) {
    emit.script('node', run, 'high');
    return;
  }
  if (hasFlag(parsed, '-e', '--eval', '-p', '--print')) return;
  emit.path(parsed.positionals[0]);
}

const MAKE_VALUE_FLAGS = new Set([
  '-C',
  '--directory',
  '-f',
  '--file',
  '--makefile',
  '-I',
  '--include-dir',
  '-j',
  '--jobs',
  '-l',
  '--load-average',
  '-o',
  '--old-file',
  '--assume-old',
  '-W',
  '--what-if',
  '--assume-new',
]);

function make(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(
    args,
    MAKE_VALUE_FLAGS,
    new Set(['-j', '--jobs', '-l', '--load-average']),
  );
  const extra = {
    dir: dirFlag(flagValue(parsed, '-C', '--directory')),
    file: flagValue(parsed, '-f', '--file', '--makefile'),
  };
  for (const word of parsed.positionals) {
    if (word.value.includes('=')) continue; // `make build VERSION=1.2`
    emit.target('make', word, extra);
  }
}

const JUST_VALUE_FLAGS = new Set([
  '-f',
  '--justfile',
  '-d',
  '--working-directory',
  '--shell',
  '--shell-arg',
  '--dotenv-filename',
  '--dotenv-path',
  '--color',
  '--chooser',
  '--command-color',
  '--list-heading',
  '--list-prefix',
]);

function just(args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(args, JUST_VALUE_FLAGS);
  // Listing and introspection flags don't run a recipe.
  if (
    hasFlag(parsed, '-l', '--list', '--summary', '--show', '-s', '--evaluate', '--choose', '--dump')
  )
    return;
  const recipe = parsed.positionals.find((w) => !w.value.includes('='));
  if (!recipe) return;
  emit.target('just', recipe, {
    dir: dirFlag(flagValue(parsed, '-d', '--working-directory')),
    file: flagValue(parsed, '-f', '--justfile'),
  });
}

function cd(args: readonly Word[], emit: Emitter): void {
  const target = args.find((w) => !w.value.startsWith('-'));
  if (!target || target.value === '~' || target.value === '-') return;
  emit.path(target, { forceDir: true });
}

const INTERPRETER_VALUE_FLAGS = new Set([
  '-c',
  '-m',
  '-e',
  '-r',
  '--require',
  '--import',
  '-W',
  '-X',
]);

function interpreter(name: string, args: readonly Word[], emit: Emitter): void {
  const parsed = parseArgs(args, INTERPRETER_VALUE_FLAGS);
  if (hasFlag(parsed, '-c', '-m', '-e')) return; // Inline code or a module, not a file.
  let positionals = parsed.positionals;
  // `deno run main.ts`; `deno task x` runs a deno.json task, which we don't verify.
  if (name === 'deno') {
    if (positionals[0]?.value !== 'run') return;
    positionals = positionals.slice(1);
  }
  emit.path(positionals[0]);
}

function dirFlag(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeRel(value);
}
