// Performance benchmark (PLAN.md §8.3): a synthetic monorepo with 50k files and 20 instruction
// files, linted and audited in-process. Target: `check` under 2 s. Run with `pnpm bench`.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audit } from '../src/api/audit.js';
import { check } from '../src/api/check.js';
import { createContext } from '../src/api/context.js';

const PACKAGES = 50;
const DIRS_PER_PACKAGE = 20;
const FILES_PER_DIR = 50; // 50 × 20 × 50 = 50,000 files.
const INSTRUCTION_FILES = 20;
const REFS_PER_FILE = 100;

async function generate(root: string): Promise<void> {
  const writes: Promise<void>[] = [];
  for (let p = 0; p < PACKAGES; p++) {
    const pkg = `packages/pkg-${p}`;
    writes.push(
      (async () => {
        for (let d = 0; d < DIRS_PER_PACKAGE; d++) {
          const dir = path.join(root, pkg, 'src', `module-${d}`);
          await mkdir(dir, { recursive: true });
          await Promise.all(
            Array.from({ length: FILES_PER_DIR }, (_, f) =>
              writeFile(path.join(dir, `file-${f}.ts`), 'export {};\n'),
            ),
          );
        }
        await writeFile(
          path.join(root, pkg, 'package.json'),
          JSON.stringify({ name: `@acme/pkg-${p}`, scripts: { build: 'tsc', test: 'vitest' } }),
        );
      })(),
    );
  }
  await Promise.all(writes);
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'acme',
      packageManager: 'pnpm@9.0.0',
      scripts: { build: 'x', lint: 'x' },
      devDependencies: { vitest: '1' },
    }),
  );
  await writeFile(path.join(root, 'Makefile'), 'build:\n\tpnpm build\n');

  for (let i = 0; i < INSTRUCTION_FILES; i++) {
    const p = i % PACKAGES;
    const lines = Array.from({ length: REFS_PER_FILE }, (_, r) => {
      const module = `packages/pkg-${(p + r) % PACKAGES}/src/module-${r % DIRS_PER_PACKAGE}`;
      switch (r % 5) {
        case 0:
          return `- See \`${module}/file-${r % FILES_PER_DIR}.ts\`.`; // exists
        case 1:
          return `- See \`${module}/missing-${r}.ts\`.`; // missing → suggestions
        case 2:
          return `- Run \`pnpm --filter @acme/pkg-${r % PACKAGES} test\` and \`make build\`.`;
        case 3:
          return `- Files matching \`${module}/**/*.ts\` use \`vitest\`.`;
        default:
          return `- Read [the guide](docs/guide-${r}.md#setup) at https://example.com/${r}.`;
      }
    });
    const file = i === 0 ? 'CLAUDE.md' : `packages/pkg-${p}/CLAUDE.md`;
    await writeFile(path.join(root, file), `# Rules ${i}\n\n${lines.join('\n')}\n`);
  }
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  console.log(`${label.padEnd(28)} ${(performance.now() - start).toFixed(0).padStart(6)} ms`);
  return result;
}

const root = await mkdtemp(path.join(os.tmpdir(), 'ctx-lint-bench-'));
try {
  await time('generate 50k files', () => generate(root));
  const ctx = await time('index (createContext)', () => createContext({ root }));
  console.log(
    `  ${ctx.files.size.files.toLocaleString()} files, ${ctx.files.size.dirs.toLocaleString()} directories`,
  );
  const result = await time('check', () => check(ctx));
  console.log(
    `  ${result.files.length} files, ${result.errorCount + result.warningCount} problems`,
  );
  const total = await time('index + check (fresh)', async () =>
    check(await createContext({ root })),
  );
  void total;
  await time('audit', () => audit(ctx));
} finally {
  await rm(root, { recursive: true, force: true });
}
