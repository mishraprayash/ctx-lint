import { agent } from './agent.js';
import { compact } from './compact.js';
import { github } from './github.js';
import { json } from './json.js';
import { sarif } from './sarif.js';
import { stylish } from './stylish.js';
import type { Format, Reporter } from './types.js';

export { JSON_FORMAT_VERSION } from './json.js';
export type { Format, ReportContext, Reporter } from './types.js';
export { FORMATS } from './types.js';

export const REPORTERS: Readonly<Record<Format, Reporter>> = {
  stylish,
  json,
  compact,
  github,
  sarif,
  agent,
};
