import { CtxLintError } from '../core/errors.js';
import { estimateTokens } from './heuristic.js';

export type TokenizerName = 'heuristic' | 'o200k' | 'cl100k';

export interface Tokenizer {
  name: TokenizerName;
  /** False for the heuristic. Results are always estimates for Claude, whose tokenizer is not public. */
  exact: boolean;
  count(text: string): number;
}

export const heuristicTokenizer: Tokenizer = {
  name: 'heuristic',
  exact: false,
  count: estimateTokens,
};

/**
 * The heuristic needs nothing; `o200k`/`cl100k` load the optional `gpt-tokenizer` package on
 * demand, so it's never loaded unless asked for.
 */
export async function loadTokenizer(name: TokenizerName): Promise<Tokenizer> {
  if (name === 'heuristic') return heuristicTokenizer;
  const encoding = name === 'o200k' ? 'o200k_base' : 'cl100k_base';
  let countTokens: (text: string, options?: { disallowedSpecial?: Set<string> }) => number;
  try {
    ({ countTokens } = (await import(`gpt-tokenizer/encoding/${encoding}`)) as {
      countTokens: typeof countTokens;
    });
  } catch {
    throw new CtxLintError(
      `The ${name} tokenizer needs the optional "gpt-tokenizer" package. Install it (npm i -D gpt-tokenizer) or use --tokenizer heuristic.`,
    );
  }
  // Text that happens to contain special-token strings (`<|endoftext|>`) is counted, not rejected.
  const options = { disallowedSpecial: new Set<string>() };
  return { name, exact: true, count: (text) => countTokens(text, options) };
}
