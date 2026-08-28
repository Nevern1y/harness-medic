import { deleteJsoncPath } from '../../parsers/index.js';
import { sha256 } from '../../core/fs.js';
import type { ConfigSource, FixOperation, McpServer, ParsedSource } from '../../core/model.js';

export interface JsonDeleteTarget {
  source: ConfigSource;
  parsed: ParsedSource;
  path: Array<string | number>;
  label: string;
}

export function buildJsonDeleteOperation(target: JsonDeleteTarget): FixOperation {
  const after = deleteJsoncPath(target.parsed.content, target.path);
  return {
    id: `op-${sha256(`${target.source.id}:${target.label}`).slice(0, 12)}`,
    path: target.source.path,
    kind: 'json-delete',
    parser: target.source.parser,
    selector: target.path.join('.'),
    beforeHash: sha256(target.parsed.content),
    beforeBytes: target.parsed.bytes,
    afterText: after,
    lineEnding: target.parsed.newline,
    description: `Remove ${target.label} from ${target.source.path}`,
  };
}

export function mcpJsonPath(source: ConfigSource, server: McpServer): Array<string | number> {
  const root = source.harness === 'opencode' ? 'mcp' : source.harness === 'codex' ? 'mcp_servers' : 'mcpServers';
  return [root, server.configuredName];
}
