import { readFile } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { ProjectContext } from '../core/context.js';
import { UsageError } from '../core/errors.js';
import { normalizeRel, relativeTo, toAbsolute } from '../core/paths.js';
import type { AgentId, SourceFile, SourceFileKind } from '../core/types.js';
import { type ParsedMarkdown, parseMarkdown } from '../parsers/markdown.js';
import type { TargetAdapter } from '../targets/adapter.js';
import { TARGETS } from '../targets/registry.js';

export interface LoadedFile extends SourceFile {
  markdown: ParsedMarkdown;
  /** Loaded on every request by the agent(s) that read it. */
  alwaysOn: boolean;
}

export interface DiscoverOptions {
  /**
   * Explicit files (absolute, or relative to `cwd`). When given, they replace discovery and
   * bypass `check.exclude`.
   */
  files?: readonly string[];
  /** Base for relative `files` (default: process.cwd()). */
  cwd?: string;
}

/** Finds, reads and parses instruction files. Results are sorted by path. */
export async function discover(
  ctx: ProjectContext,
  options: DiscoverOptions = {},
): Promise<LoadedFile[]> {
  const paths =
    options.files && options.files.length > 0
      ? explicitPaths(ctx, options.files, options.cwd ?? process.cwd())
      : discoveredPaths(ctx);

  const files = await Promise.all(paths.map((rel) => loadFile(ctx, rel)));
  ctx.logger.debug(`Discovered ${files.length} instruction file(s).`);
  return files;
}

function discoveredPaths(ctx: ProjectContext): string[] {
  const { config, files } = ctx;
  const globs = [
    ...TARGETS.flatMap((target) => target.detect),
    sourceGlob(config.sources),
    ...config.check.include,
  ];
  const isExcluded =
    config.check.exclude.length > 0 ? picomatch(config.check.exclude, { dot: true }) : () => false;
  return files.match(globs).filter((rel) => !isExcluded(rel));
}

function explicitPaths(ctx: ProjectContext, inputs: readonly string[], cwd: string): string[] {
  const result = new Set<string>();
  for (const input of inputs) {
    const rel = relativeTo(ctx.root, path.resolve(cwd, input));
    if (rel === null) {
      throw new UsageError(`${input} is outside the project root (${ctx.root}).`);
    }
    if (!ctx.files.isFile(rel)) {
      throw new UsageError(`No such file: ${input}`);
    }
    result.add(rel);
  }
  return [...result].sort();
}

async function loadFile(ctx: ProjectContext, rel: string): Promise<LoadedFile> {
  const absPath = toAbsolute(ctx.root, rel);
  const content = stripBom(await readFile(absPath, 'utf8'));
  const markdown = parseMarkdown(content);
  const info = { path: rel, frontmatter: markdown.frontmatter?.data ?? null };

  const targets = TARGETS.filter((target) => matchesTarget(target, rel));
  const kind: SourceFileKind =
    targets.length > 0
      ? 'instructions'
      : picomatch.isMatch(rel, sourceGlob(ctx.config.sources), { dot: true })
        ? 'source'
        : 'extra';

  return {
    path: rel,
    absPath,
    kind,
    agents: targets.map((target) => target.id) as AgentId[],
    content,
    markdown,
    alwaysOn: targets.some((target) => target.isAlwaysOn(info)),
  };
}

const detectMatchers = new Map<TargetAdapter, picomatch.Matcher>();

function matchesTarget(target: TargetAdapter, rel: string): boolean {
  let isMatch = detectMatchers.get(target);
  if (!isMatch) {
    isMatch = picomatch([...target.detect], { dot: true });
    detectMatchers.set(target, isMatch);
  }
  return isMatch(rel);
}

function sourceGlob(sources: string): string {
  return `${normalizeRel(sources)}/**/*.md`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
