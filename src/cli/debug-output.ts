import path from 'node:path';
import type { ProjectContext } from '../core/context.js';
import type { Colors } from '../core/logger.js';
import type { Classification } from '../core/references.js';
import type { LoadedFile } from '../discovery/index.js';

// Output for the debugging flags of `ctx-lint check` (`--list-files`, `--dump-refs`).

export function fileListJson(ctx: ProjectContext, files: readonly LoadedFile[]) {
  return {
    root: ctx.root,
    config: ctx.configPath,
    files: files.map(({ path: p, kind, agents, alwaysOn }) => ({
      path: p,
      kind,
      agents,
      alwaysOn,
    })),
  };
}

export function formatFileList(
  ctx: ProjectContext,
  files: readonly LoadedFile[],
  c: Colors,
): string {
  const config = ctx.configPath ? path.relative(ctx.root, ctx.configPath) : 'none (using defaults)';
  const lines = [`${c.dim('Root:  ')} ${ctx.root}`, `${c.dim('Config:')} ${config}`, ''];
  if (files.length === 0) {
    lines.push(c.yellow('No instruction files found.'));
    return `${lines.join('\n')}\n`;
  }

  const width = Math.max(...files.map((f) => f.path.length));
  for (const file of files) {
    const who = file.kind === 'instructions' ? file.agents.join(', ') : file.kind;
    const tags = [c.cyan(who), file.alwaysOn ? c.green('always-on') : ''].filter(Boolean);
    lines.push(`  ${file.path.padEnd(width)}  ${tags.join('  ')}`);
  }
  lines.push('', c.dim(`${files.length} file${files.length === 1 ? '' : 's'}`));
  return `${lines.join('\n')}\n`;
}

export interface FileReferences {
  file: LoadedFile;
  refs: Classification[];
}

/** One JSON-safe object per classification (no functions or parsed trees). */
export function referencesJson(entries: readonly FileReferences[], includeIgnored: boolean) {
  return entries.flatMap(({ file, refs }) =>
    refs
      .filter((ref) => includeIgnored || ref.kind !== 'ignored')
      .map((ref) => {
        const { candidate, ...rest } = ref;
        const range = 'range' in ref ? ref.range : candidate.range;
        return {
          file: file.path,
          line: range.start.line,
          column: range.start.column,
          ...('range' in rest ? omit(rest, 'range') : rest),
          raw: candidate.raw,
          origin: candidate.origin,
        };
      }),
  );
}

export function formatReferences(
  entries: readonly FileReferences[],
  c: Colors,
  includeIgnored: boolean,
): string {
  const out: string[] = [];
  let total = 0;
  for (const { file, refs } of entries) {
    const shown = refs.filter((ref) => includeIgnored || ref.kind !== 'ignored');
    if (shown.length === 0) continue;
    total += shown.filter((ref) => ref.kind !== 'ignored').length;
    out.push(c.underline(file.path));
    for (const ref of shown) {
      const range = ref.kind === 'ignored' ? ref.candidate.range : ref.range;
      const loc = `${range.start.line}:${range.start.column}`.padEnd(8);
      if (ref.kind === 'ignored') {
        out.push(
          c.dim(`  ${loc} ${'ignored'.padEnd(8)} ${ref.reason.padEnd(10)} ${ref.candidate.raw}`),
        );
      } else {
        const confidence = ref.confidence.padEnd(10);
        const colored =
          ref.confidence === 'high'
            ? c.green(confidence)
            : ref.confidence === 'medium'
              ? c.yellow(confidence)
              : c.dim(confidence);
        out.push(`  ${c.dim(loc)} ${c.cyan(ref.kind.padEnd(8))} ${colored} ${describe(ref)}`);
      }
    }
    out.push('');
  }
  out.push(
    c.dim(
      `${total} reference${total === 1 ? '' : 's'}${includeIgnored ? '' : ' (add --debug to include ignored candidates)'}`,
    ),
  );
  return `${out.join('\n')}\n`;
}

function describe(ref: Exclude<Classification, { kind: 'ignored' }>): string {
  switch (ref.kind) {
    case 'path': {
      const flags = [
        ref.isDir && 'dir',
        ref.isGlob && 'glob',
        ref.bare && 'anywhere',
        ref.fromFile && 'relative',
        ref.anchor !== undefined && `#${ref.anchor}`,
      ].filter(Boolean);
      return `${ref.value}${flags.length > 0 ? `  (${flags.join(', ')})` : ''}`;
    }
    case 'script': {
      const flags = [
        ref.workspace !== undefined && `workspace ${ref.workspace}`,
        ref.dir !== undefined && `in ${ref.dir}`,
        ref.recursive && 'recursive',
        ref.orBin && 'or bin',
        ref.ifPresent && 'if present',
      ].filter(Boolean);
      return `${ref.tool} script "${ref.name}"${flags.length > 0 ? `  (${flags.join(', ')})` : ''}`;
    }
    case 'target':
      return `${ref.tool} target "${ref.name}"${ref.dir ? `  (in ${ref.dir})` : ''}${ref.file ? `  (file ${ref.file})` : ''}`;
    case 'bin':
      return `${ref.tool} bin "${ref.name}"`;
    case 'package':
      return `npm package "${ref.name}"${ref.negated ? '  (negated: need not be installed)' : ''}`;
  }
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}
