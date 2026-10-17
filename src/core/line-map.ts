import type { Position } from './types.js';

/** Converts 0-based offsets to 1-based line/column positions for one file. */
export class LineMap {
  private readonly lineStarts: number[] = [0];

  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): Position {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((this.lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (this.lineStarts[lo] as number) + 1, offset };
  }

  /** Offset of the first character of a 1-based line. */
  lineStart(line: number): number {
    return this.lineStarts[line - 1] ?? this.text.length;
  }

  /** Text of a 1-based line, without its line terminator. */
  lineText(line: number): string {
    const start = this.lineStart(line);
    const next = this.lineStarts[line];
    const end = next === undefined ? this.text.length : next - 1;
    return this.text.slice(start, end).replace(/\r$/, '');
  }
}
