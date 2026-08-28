import type { EffectiveEnvironment } from '../model.js';

export interface ToolLimit {
  value: number;
  source: string;
}

export function knownToolLimit(environment: EffectiveEnvironment): ToolLimit | undefined {
  for (const [key, value] of Object.entries(environment.unknownFields)) {
    if (!/(?:tool|mcp).*(?:limit|max)|(?:limit|max).*(?:tool|mcp)/i.test(key) || typeof value !== 'number' || value <= 0) continue;
    return { value, source: key };
  }
  for (const server of environment.mcpServers) {
    const raw = server.rawMetadata ?? {};
    const candidate = raw.toolLimit ?? raw.maxTools ?? raw.tool_limit;
    if (typeof candidate === 'number' && candidate > 0) return { value: candidate, source: `${server.sourceId}:explicit-policy` };
  }
  return undefined;
}
