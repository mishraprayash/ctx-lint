import type { ProjectContext } from '../core/context.js';
import type { Classification } from '../core/references.js';
import type { LoadedFile } from '../discovery/index.js';
import { classify, classifyContextFor } from './classify/index.js';
import { extractCandidates } from './extract.js';

/** Extracts and classifies every candidate in a file, in document order. */
export function referencesOf(ctx: ProjectContext, file: LoadedFile): Classification[] {
  const classifyCtx = classifyContextFor(ctx, file.path);
  return extractCandidates(file).flatMap((candidate) => classify(candidate, classifyCtx));
}
