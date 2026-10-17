import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createContext } from '../../../src/api/context.js';
import type { Reference } from '../../../src/core/references.js';
import { discover } from '../../../src/discovery/index.js';
import { classify, classifyContextFor } from '../../../src/parsers/classify/index.js';
import { extractCandidates } from '../../../src/parsers/extract.js';

const fixture = fileURLToPath(new URL('../../fixtures/false-positives', import.meta.url));

// The false-positive gate (PLAN.md §8.1). In Phase 3 this becomes "zero diagnostics".
it('finds no medium- or high-confidence references in the false-positives fixture', async () => {
  const ctx = await createContext({ root: fixture });
  const [file] = await discover(ctx);
  if (!file) throw new Error('fixture CLAUDE.md not discovered');

  const candidates = extractCandidates(file);
  // Guard against a vacuous pass: the fixture is full of reference look-alikes.
  expect(candidates.length).toBeGreaterThan(50);

  const refs = candidates
    .flatMap((candidate) => classify(candidate, classifyContextFor(ctx, file.path)))
    .filter((c): c is Reference => c.kind !== 'ignored')
    .filter((c) => c.confidence !== 'low')
    .filter((c) => !(c.kind === 'package' && c.negated))
    .map((c) => `${c.range.start.line}:${c.range.start.column} ${c.kind} ${c.candidate.raw}`);

  expect(refs).toEqual([]);
});
