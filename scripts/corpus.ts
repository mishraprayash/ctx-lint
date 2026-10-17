// Real-world false-positive run (PLAN.md §8.2). Run with `pnpm corpus [outDir]`.
//
// For each repo in test/corpus/repos.json: a blobless shallow clone, empty placeholders for
// every path in the tree (enough for existence checks), and real content only for the files
// ctx-lint reads (markdown, rule files, manifests, .gitignore). Then `check` runs in-process
// and every diagnostic is written to <outDir>/report.md with its source line, for triage.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { check } from '../src/api/check.js';
import { createContext } from '../src/api/context.js';

/** Files ctx-lint reads (everything else only needs to exist). */
const READ =
  /(?:\.md|\.mdc|\.mk|\/?\.cursorrules|\/?\.windsurfrules|(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|[Mm]akefile|GNUmakefile|[Jj]ustfile|tsconfig[^/]*\.json|jsconfig\.json|\.gitignore))$/;

// `pnpm corpus [dir] [--offline] [--limit N] [--only a/b,c/d]`: --offline lints only repos that
// were already fetched; --limit uses the first N repos in repos.json, --only the ones named.
// Fetches are resumable: a repo is fetched again only if its last fetch didn't finish.
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const outDir = path.resolve(
  args.find((a, i) => !a.startsWith('--') && !['--limit', '--only'].includes(args[i - 1] ?? '')) ??
    path.join(os.tmpdir(), 'ctx-lint-corpus'),
);
const { repos: allRepos } = JSON.parse(
  readFileSync(new URL('../test/corpus/repos.json', import.meta.url), 'utf8'),
) as { repos: string[] };
// `--limit 10`: only the first N repos (each skeleton is small, but the clones add up).
const option = (name: string): string | undefined => {
  const arg = args.find((a) => a === name || a.startsWith(`${name}=`));
  if (arg === undefined) return undefined;
  return arg.includes('=') ? arg.slice(name.length + 1) : args[args.indexOf(arg) + 1];
};
const limit = Number(option('--limit') ?? Number.POSITIVE_INFINITY);
// `--only vitejs/vite,astral-sh/uv`: a held-out check on repos the heuristics weren't tuned on.
const only = option('--only')?.split(',').filter(Boolean);
const unknown = only?.filter((repo) => !allRepos.includes(repo)) ?? [];
if (unknown.length > 0) throw new Error(`Not in repos.json: ${unknown.join(', ')}`);
const repos = only ?? allRepos.slice(0, limit);

/** Repos fetched at the same time. Fetching is network-bound; linting runs afterwards. */
const CONCURRENCY = 4;

const run = promisify(execFile);
const git = async (cwd: string, args: string[]) =>
  (await run('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })).stdout;

const dirFor = (repo: string) => path.join(outDir, repo.replace('/', '__'));
const fetched = (repo: string) => existsSync(path.join(dirFor(repo), '.git', 'ctx-lint-done'));

async function fetchSkeleton(repo: string): Promise<void> {
  const dir = dirFor(repo);
  if (fetched(repo)) return;
  rmSync(dir, { recursive: true, force: true }); // A fetch that was interrupted.
  mkdirSync(dir, { recursive: true });
  await git(outDir, [
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--filter=blob:none',
    '--no-checkout',
    `https://github.com/${repo}.git`,
    dir,
  ]);
  const files = (await git(dir, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']))
    .split('\0')
    .filter(Boolean);
  for (const file of files) {
    const abs = path.join(dir, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    if (!existsSync(abs)) writeFileSync(abs, '');
  }
  // One checkout for every file we read: git fetches the missing blobs in a single batch.
  const wanted = files.filter((f) => READ.test(f));
  writeFileSync(path.join(dir, '.git', 'ctx-lint-paths'), `${wanted.join('\0')}\0`);
  await git(dir, [
    'checkout',
    'HEAD',
    '--pathspec-from-file=.git/ctx-lint-paths',
    '--pathspec-file-nul',
  ]);
  writeFileSync(path.join(dir, '.git', 'ctx-lint-done'), '');
}

/** Fetches every repo that isn't there yet, a few at a time. Returns the ones that failed. */
async function fetchAll(): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  const queue = repos.filter((repo) => !fetched(repo));
  const worker = async () => {
    for (let repo = queue.shift(); repo !== undefined; repo = queue.shift()) {
      const started = Date.now();
      try {
        await fetchSkeleton(repo);
        console.log(`fetched ${repo} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      } catch (error) {
        const message =
          error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
        failed.set(repo, message);
        console.log(`fetch failed: ${repo}: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failed;
}

mkdirSync(outDir, { recursive: true });
const report: string[] = ['# ctx-lint corpus run', ''];
let totalFiles = 0;
let totalDiagnostics = 0;
let linted = 0;

const failed = offline ? new Map<string, string>() : await fetchAll();

for (const repo of repos) {
  const dir = dirFor(repo);
  if (!fetched(repo)) {
    if (!failed.has(repo)) console.log(`${repo} … not fetched (offline)`);
    continue;
  }
  process.stdout.write(`${repo} … `);
  linted++;
  const ctx = await createContext({ root: dir });
  const result = await check(ctx);
  const diagnostics = result.files.flatMap((f) => f.diagnostics.map((d) => ({ file: f.path, d })));
  totalFiles += result.files.length;
  totalDiagnostics += diagnostics.length;
  console.log(
    `${result.files.length} files, ${result.errorCount} errors, ${result.warningCount} warnings`,
  );

  report.push(`## ${repo} (${result.files.length} files, ${diagnostics.length} diagnostics)`, '');
  for (const { file, d } of diagnostics) {
    const line =
      readFileSync(path.join(dir, file), 'utf8').split('\n')[d.range.start.line - 1]?.trim() ?? '';
    report.push(
      `- \`${file}:${d.range.start.line}:${d.range.start.column}\` **${d.severity}** ${d.ruleId}: ${d.message}`,
      `  > ${line.slice(0, 200)}`,
    );
  }
  report.push('');
}

report.splice(
  2,
  0,
  `${linted} repos, ${totalFiles} instruction files, ${totalDiagnostics} diagnostics.`,
  '',
);
writeFileSync(path.join(outDir, 'report.md'), `${report.join('\n')}\n`);
console.log(`\nReport: ${path.join(outDir, 'report.md')}`);
