import { sha256 } from '../fs.js';
import type { McpServer, ToolMetadata } from '../model.js';

export function canonicalToolSignature(tool: ToolMetadata): string {
  return `${tool.name}|${stableValue(tool.description ?? '')}|${stableValue(tool.inputSchema ?? {})}|${stableValue(tool.outputSchema ?? {})}|${stableValue(tool.annotations ?? {})}`;
}

export function duplicateGroups(servers: McpServer[]): McpServer[][] {
  const groups = new Map<string, McpServer[]>();
  for (const server of servers) {
    if (server.transport === 'unknown') continue;
    const group = groups.get(server.canonicalIdentity) ?? [];
    group.push(server);
    groups.set(server.canonicalIdentity, group);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((left, right) => (left[0]?.canonicalIdentity ?? '').localeCompare(right[0]?.canonicalIdentity ?? ''));
}

export function sameNameCollisions(servers: McpServer[]): McpServer[][] {
  const groups = new Map<string, McpServer[]>();
  for (const server of servers) {
    if (server.transport === 'unknown') continue;
    const group = groups.get(server.configuredName) ?? [];
    group.push(server);
    groups.set(server.configuredName, group);
  }
  return [...groups.values()].filter((group) => new Set(group.map((server) => server.canonicalIdentity)).size > 1).sort((left, right) => (left[0]?.configuredName ?? '').localeCompare(right[0]?.configuredName ?? ''));
}


export function metadataHash(tool: ToolMetadata): string {
  return sha256(canonicalToolSignature(tool));
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${stableValue(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
