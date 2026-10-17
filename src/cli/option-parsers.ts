import { InvalidArgumentError } from 'commander';

export function parseCount(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError(`expected a non-negative integer, got "${value}".`);
  }
  return n;
}

/** Accumulates a repeatable option into an array. */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
