import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG_PATH } from '../config/load.js';
import type { ProjectContext } from '../core/context.js';
import { UsageError } from '../core/errors.js';
import { joinRel, normalizeRel, toAbsolute } from '../core/paths.js';
import { AGENT_IDS, type AgentId } from '../core/types.js';
import { discover } from '../discovery/index.js';
import { type ImportResult, importFiles, renderImportedRule } from '../syncer/import.js';
import { loadSources } from '../syncer/ir.js';
import { TARGETS } from '../targets/registry.js';

export interface InitOptions {
  /** Import existing agent files into source rules. */
  import?: boolean;
  /** With `import`: one rule per H2 section of monolithic files. */
  split?: boolean;
}

export interface InitResult {
  /** Repo-relative paths written. */
  created: string[];
  /** The config file already existed and was left alone. */
  configExisted: boolean;
  enabledTargets: AgentId[];
  imported?: ImportResult;
}

const SCHEMA_URL = 'https://unpkg.com/ctx-lint/schema/config.schema.json';

const SAMPLE_RULE = `---
description: Project conventions every agent should follow
alwaysApply: true
---

- Describe the project, how it's laid out and the commands to build and test it.
- Keep it short: always-applied rules cost tokens on every request.
`;

/** Scaffolds `.context/`, optionally importing existing agent files. Never overwrites files. */
export async function init(ctx: ProjectContext, options: InitOptions = {}): Promise<InitResult> {
  const created: string[] = [];
  const sources = normalizeRel(ctx.config.sources);
  const existingSources = ctx.files.match(`${sources}/**/*.md`);
  const configExisted = ctx.configPath !== null || ctx.files.isFile(DEFAULT_CONFIG_PATH);
  if (!options.import && configExisted && existingSources.length > 0) {
    throw new UsageError(
      `ctx-lint is already set up here (${DEFAULT_CONFIG_PATH} and ${sources} exist). Use \`ctx-lint init --import\` to import more files.`,
    );
  }

  let imported: ImportResult | undefined;
  const agentsInUse = new Set<AgentId>(['claude', 'agents']);
  if (options.import) {
    const files = await discover(ctx);
    for (const file of files) for (const agent of file.agents) agentsInUse.add(agent);
    const { rules: existing } = await loadSources(ctx);
    imported = importFiles(files, {
      split: options.split === true,
      existingBodies: existing.map((rule) => rule.body),
    });
    for (const rule of imported.rules) {
      const rel = uniquePath(ctx, sources, rule.id, created);
      await write(ctx, rel, renderImportedRule(rule));
      created.push(rel);
    }
  } else {
    // Without --import, turn on the targets whose files are already in the repo.
    for (const target of TARGETS) {
      if (ctx.files.match([...target.detect]).length > 0) agentsInUse.add(target.id);
    }
    if (existingSources.length === 0) {
      const rel = joinRel(sources, 'general.md');
      await write(ctx, rel, SAMPLE_RULE);
      created.push(rel);
    }
  }

  const enabledTargets = AGENT_IDS.filter((id) => agentsInUse.has(id));
  if (!configExisted) {
    const config = {
      $schema: SCHEMA_URL,
      targets: Object.fromEntries(AGENT_IDS.map((id) => [id, { enabled: agentsInUse.has(id) }])),
    };
    await write(ctx, DEFAULT_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    created.push(DEFAULT_CONFIG_PATH);
  }

  return { created, configExisted, enabledTargets, ...(imported ? { imported } : {}) };
}

/** `<sources>/<id>.md`, with `-2`, `-3`… if that file already exists. */
function uniquePath(
  ctx: ProjectContext,
  sources: string,
  id: string,
  taken: readonly string[],
): string {
  for (let n = 1; ; n++) {
    const rel = joinRel(sources, `${n === 1 ? id : `${id}-${n}`}.md`);
    if (!ctx.files.exists(rel) && !taken.includes(rel)) return rel;
  }
}

async function write(ctx: ProjectContext, rel: string, content: string): Promise<void> {
  const abs = toAbsolute(ctx.root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, { flag: 'wx' }); // Fails rather than overwrite.
}
