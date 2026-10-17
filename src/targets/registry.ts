import type { AgentId } from '../core/types.js';
import type { TargetAdapter } from './adapter.js';
import { agentsTarget } from './agents.js';
import { claudeTarget } from './claude.js';
import { copilotTarget } from './copilot.js';
import { cursorTarget } from './cursor.js';
import { windsurfTarget } from './windsurf.js';

export const TARGETS: readonly TargetAdapter[] = [
  claudeTarget,
  agentsTarget,
  cursorTarget,
  copilotTarget,
  windsurfTarget,
];

export function getTarget(id: AgentId): TargetAdapter {
  const target = TARGETS.find((t) => t.id === id);
  if (!target) throw new Error(`Unknown target: ${id}`);
  return target;
}
