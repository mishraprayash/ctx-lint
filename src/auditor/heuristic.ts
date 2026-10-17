// An offline token estimate with no dependencies (PLAN.md §7.1).
//
// Text is split the way BPE tokenizers pre-split it (letter runs with case changes, numbers in
// groups of three, punctuation runs, newline runs, whitespace), and each kind of piece gets a
// weight. The weights are fitted against o200k by `pnpm calibrate` (scripts/calibrate-tokenizer.ts);
// see docs/audit.md for the measured error.

/** Roughly the o200k pre-tokenizer: letters (split at case changes), digits, punctuation, whitespace. */
const PIECE =
  /[^\r\n\p{L}\p{N}]?\p{Lu}?[\p{Ll}\p{Lm}\p{Lo}\p{M}]+|[^\r\n\p{L}\p{N}]?\p{Lu}+(?![\p{Ll}])|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

export interface Features {
  /** Words of 1–4 letters: almost always one token. */
  shortWords: number;
  /** Words of 5–8 letters. */
  mediumWords: number;
  /** Letters in words longer than 8 (split into several tokens). */
  longWordLetters: number;
  /** Groups of up to three digits. */
  numbers: number;
  /** Punctuation runs, and their extra characters beyond the first. */
  punctuationRuns: number;
  punctuationExtra: number;
  /** Runs of newlines (with surrounding indentation). */
  newlines: number;
  /** Other whitespace runs (indentation, double spaces). */
  spaces: number;
  /** Letters outside Latin script (CJK etc. tokenize far less efficiently). */
  nonLatinLetters: number;
}

export const FEATURE_NAMES: readonly (keyof Features)[] = [
  'shortWords',
  'mediumWords',
  'longWordLetters',
  'numbers',
  'punctuationRuns',
  'punctuationExtra',
  'newlines',
  'spaces',
  'nonLatinLetters',
];

export function extractFeatures(text: string): Features {
  const f: Features = {
    shortWords: 0,
    mediumWords: 0,
    longWordLetters: 0,
    numbers: 0,
    punctuationRuns: 0,
    punctuationExtra: 0,
    newlines: 0,
    spaces: 0,
    nonLatinLetters: 0,
  };
  for (const [piece] of text.matchAll(PIECE)) {
    const letters = piece.replace(/[^\p{L}\p{M}]/gu, '');
    if (letters.length > 0) {
      const nonLatin = letters.replace(/[\p{Script=Latin}]/gu, '').length;
      if (nonLatin > 0) {
        f.nonLatinLetters += nonLatin;
        continue;
      }
      if (letters.length <= 4) f.shortWords++;
      else if (letters.length <= 8) f.mediumWords++;
      else f.longWordLetters += letters.length;
    } else if (/^\p{N}+$/u.test(piece)) {
      f.numbers++;
    } else if (/[\r\n]/.test(piece) && piece.trim() === '') {
      f.newlines++;
    } else if (piece.trim() === '') {
      f.spaces++;
    } else {
      const punct = piece.replace(/\s/g, '');
      f.punctuationRuns++;
      f.punctuationExtra += Math.max(0, punct.length - 1);
    }
  }
  return f;
}

export type Weights = Readonly<Record<keyof Features, number>>;

/**
 * Fitted by `pnpm calibrate` against o200k_base (2026-10-17). On 191 markdown files (326k tokens):
 * median error 3.1%, p90 7.2%, max 18.5% (a page of Unicode symbols), bias -0.3%. Regenerate
 * after changing `extractFeatures`.
 */
export const WEIGHTS: Weights = {
  shortWords: 0.888,
  mediumWords: 1.123,
  longWordLetters: 0.231,
  numbers: 1.113,
  punctuationRuns: 0.902,
  punctuationExtra: 0.504,
  newlines: 1.346,
  spaces: 0.699,
  nonLatinLetters: 1.65,
};

export function estimateTokens(text: string, weights: Weights = WEIGHTS): number {
  if (text === '') return 0;
  const f = extractFeatures(text);
  let total = 0;
  for (const name of FEATURE_NAMES) total += f[name] * weights[name];
  return Math.max(1, Math.round(total));
}
