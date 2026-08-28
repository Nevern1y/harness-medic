import { promises as nodeFs } from 'node:fs';
import { redactValue, redactText } from '../core/redaction.js';

export interface TranscriptEvent {
  timestamp?: string;
  type: string;
  contextId?: string;
  parentContextId?: string;
  server?: string;
  tool?: string;
  payload?: unknown;
}

export type TranscriptCoverage = 'complete' | 'partial' | 'empty' | 'expired';

export interface TranscriptReadOptions {
  now?: Date;
  maxAgeMs?: number;
}

export interface TranscriptWindow {
  sourcePath: string;
  startedAt?: string;
  endedAt?: string;
  complete: boolean;
  coverage: TranscriptCoverage;
  diagnostics: string[];
  events: TranscriptEvent[];
  contextIds: string[];
}

export interface DuplicateToolAction {
  server: string;
  tool: string;
  count: number;
  contextIds: string[];
}

export async function readTranscript(filePath: string, options: TranscriptReadOptions = {}): Promise<TranscriptWindow> {
  const content = await nodeFs.readFile(filePath, 'utf8');
  const values: unknown[] = [];
  const diagnostics: string[] = [];
  if (content.trimStart().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) values.push(...parsed);
      else diagnostics.push('Transcript JSON root must be an array.');
    } catch {
      diagnostics.push('Transcript JSON array is not valid JSON.');
    }
  } else {
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        diagnostics.push(`Transcript line ${index + 1} is not valid JSON`);
      }
    }
  }
  const events: TranscriptEvent[] = values.flatMap((value) => normalizeEvent(value));
  const timestamps = events.map((event) => event.timestamp).filter((value): value is string => Boolean(value)).sort();
  const complete = events.some((event) => event.type === 'session.end' || event.type === 'complete');
  let coverage: TranscriptCoverage = complete ? 'complete' : events.length > 0 ? 'partial' : 'empty';
  const maxAgeMs = options.maxAgeMs;
  const endedAt = timestamps.at(-1);
  if (endedAt && maxAgeMs !== undefined && Number.isFinite(maxAgeMs) && maxAgeMs >= 0) {
    const endedTime = Date.parse(endedAt);
    const nowTime = (options.now ?? new Date()).getTime();
    if (Number.isFinite(endedTime) && nowTime - endedTime > maxAgeMs) coverage = 'expired';
  }
  return {
    sourcePath: filePath,
    ...(timestamps[0] ? { startedAt: timestamps[0] } : {}),
    ...(endedAt ? { endedAt } : {}),
    complete,
    coverage,
    diagnostics,
    events,
    contextIds: [...new Set(events.flatMap((event) => [event.contextId, event.parentContextId].filter((value): value is string => Boolean(value))))].sort(),
  };
}


function normalizeEvent(value: unknown): TranscriptEvent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string') return [];
  return [{
    type: redactText(record.type),
    ...(typeof record.timestamp === 'string' ? { timestamp: record.timestamp } : {}),
    ...(typeof record.contextId === 'string' ? { contextId: redactText(record.contextId) } : {}),
    ...(typeof record.parentContextId === 'string' ? { parentContextId: redactText(record.parentContextId) } : {}),
    ...(typeof record.server === 'string' ? { server: redactText(record.server) } : {}),
    ...(typeof record.tool === 'string' ? { tool: redactText(record.tool) } : {}),
    ...(record.payload !== undefined ? { payload: redactValue(record.payload) } : {}),
  }];
}

export function observedToolActions(window: TranscriptWindow): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of window.events) {
    if (!event.server || !event.tool || !/(?:tool|call|action)/i.test(event.type)) continue;
    const key = `${event.server}:${event.tool}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function contextToolInventory(window: TranscriptWindow): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const event of window.events) {
    if (!event.contextId || !event.tool) continue;
    const tools = result.get(event.contextId) ?? new Set<string>();
    tools.add(event.tool);
    result.set(event.contextId, tools);
  }
  return result;
}

export function duplicateToolActions(window: TranscriptWindow): DuplicateToolAction[] {
  const groups = new Map<string, { server: string; tool: string; count: number; contextIds: Set<string> }>();
  for (const event of window.events) {
    if (!event.server || !event.tool || !/(?:tool|call|action)/i.test(event.type)) continue;
    const key = `${event.server}:${event.tool}`;
    const group = groups.get(key) ?? { server: event.server, tool: event.tool, count: 0, contextIds: new Set<string>() };
    group.count += 1;
    if (event.contextId) group.contextIds.add(event.contextId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.count > 1)
    .map((group) => ({ server: group.server, tool: group.tool, count: group.count, contextIds: [...group.contextIds].sort() }))
    .sort((left, right) => `${left.server}:${left.tool}`.localeCompare(`${right.server}:${right.tool}`));
}
