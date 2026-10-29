// Prints the CHANGELOG.md section for a version, for the GitHub release notes.
// Usage: node scripts/release-notes.mjs 0.1.0
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version>');
  process.exit(2);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = changelog.split(/^## /m).slice(1);
const section = sections.find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`));
if (!section) {
  console.error(`CHANGELOG.md has no "## ${version}" section.`);
  process.exit(1);
}
process.stdout.write(`${section.slice(section.indexOf('\n') + 1).trim()}\n`);
