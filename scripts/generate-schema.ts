// Regenerates schema/config.schema.json from the zod schema. Run with `pnpm schema`.
// A unit test fails when the committed file is out of date.
import { writeFile } from 'node:fs/promises';
import { renderJsonSchema } from '../src/config/json-schema.js';

const target = new URL('../schema/config.schema.json', import.meta.url);
await writeFile(target, renderJsonSchema());
console.log(`Wrote ${target.pathname}`);
