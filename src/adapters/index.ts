import type { HarnessAdapter, HarnessId } from '../core/model.js';
import { claudeCodeAdapter } from './claude-code/index.js';
import { codexAdapter } from './codex/index.js';
import { opencodeAdapter } from './opencode/index.js';
import { cursorAdapter } from './cursor/index.js';

export const adapters: HarnessAdapter[] = [claudeCodeAdapter, codexAdapter, opencodeAdapter, cursorAdapter];

export function selectAdapters(selected: HarnessId[]): HarnessAdapter[] {
  const selectedSet = new Set(selected);
  return adapters.filter((adapter) => selectedSet.has(adapter.id));
}
