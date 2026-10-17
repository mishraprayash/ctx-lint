import { z } from 'zod';
import { configSchema } from './schema.js';

/** Renders the published JSON Schema for `.context/config.json`. */
export function renderJsonSchema(): string {
  // `io: 'input'` describes what users write: fields with defaults are optional.
  const schema = z.toJSONSchema(configSchema, { io: 'input', target: 'draft-2020-12' });
  return `${JSON.stringify({ ...schema, title: 'ctx-lint config' }, null, 2)}\n`;
}
