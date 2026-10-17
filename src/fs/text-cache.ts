import { readFileSync } from 'node:fs';
import { toAbsolute } from '../core/paths.js';

/** Reads repo files once per run. Missing or unreadable files read as `null`. */
export class TextCache {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly root: string) {}

  read(rel: string): string | null {
    if (this.cache.has(rel)) return this.cache.get(rel) ?? null;
    let text: string | null;
    try {
      text = readFileSync(toAbsolute(this.root, rel), 'utf8');
    } catch {
      text = null;
    }
    this.cache.set(rel, text);
    return text;
  }
}
