import { describe, expect, it } from 'vitest';
import { mergeMcpByName, normalizeMcpServers } from '../../src/adapters/common.js';
import { duplicateGroups, sameNameCollisions } from '../../src/core/mcp/identity.js';
import { knownToolLimit } from '../../src/core/mcp/limits.js';
import { emptyEnvironment } from '../helpers.js';
import type { ConfigSource, McpServer, ScanContext, ScanServices } from '../../src/core/model.js';

const source: ConfigSource = {
  id: 'test:mcp', harness: 'claude-code', kind: 'mcp', scope: 'project', path: 'C:/workspace/.mcp.json', priority: 50,
  applicable: true, ownership: 'workspace', parser: 'json', parseStatus: 'parsed', diagnostics: [], discoveredBy: 'test',
};
const context: ScanContext = {
  cwd: 'C:/workspace', home: 'C:/home', platform: 'win32', envNames: ['PATH', 'PRESENT'], selectedHarnesses: ['claude-code'],
  scanTier: 0, consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false },
};
const services: ScanServices = {
  isWindows: true, redactionSalt: 'test', now: () => new Date(0), fs: {} as never,
  resolveExecutable: async (command: string) => command.toLowerCase() === 'node' ? 'C:/Program Files/node.exe' : undefined,
};

describe('MCP identity', () => {
  it('canonicalizes equal stdio targets despite different names', async () => {
    const servers = await normalizeMcpServers({ mcpServers: {
      alpha: { command: 'node', args: ['server.js'], cwd: '.', env: { API_KEY: '${PRESENT}' } },
      beta: { command: 'node', args: ['server.js'], cwd: 'C:/workspace', env: { API_KEY: '${PRESENT}' } },
    } }, source, context, services);
    expect(servers).toHaveLength(2);
    expect(duplicateGroups(servers)).toHaveLength(1);
    expect(servers[0]?.envKeyNames).toContain('API_KEY');
    expect(JSON.stringify(servers)).not.toContain('CANARY');
  });
  it('does not expose registrations from an inapplicable source', async () => {
    const environment = emptyEnvironment();
    const inapplicable = { ...source, id: 'test:mcp:outside', applicable: false };
    const server: McpServer = {
      id: 'server-outside', sourceId: inapplicable.id, configuredName: 'outside', canonicalIdentity: 'stdio|outside', transport: 'stdio',
      envKeyNames: [], enabled: true, active: true, trust: 'workspace',
    };
    await mergeMcpByName([{ source: inapplicable, servers: [server] }], environment);
    expect(environment.mcpServers).toEqual([]);
    expect(environment.tools).toEqual([]);
  });

  it('keeps same-name different targets as a collision', () => {
    const environment = emptyEnvironment();
    const base = { id: '1', sourceId: 's', configuredName: 'same', transport: 'streamable-http' as const, envKeyNames: [], enabled: true, active: true, trust: 'workspace' as const };
    environment.mcpServers = [
      { ...base, canonicalIdentity: 'remote|https://one.test' },
      { ...base, id: '2', canonicalIdentity: 'remote|https://two.test' },
    ];
    expect(sameNameCollisions(environment.mcpServers)).toHaveLength(1);
  });

  it('uses only explicit configured tool limits', () => {
    const environment = emptyEnvironment();
    expect(knownToolLimit(environment)).toBeUndefined();
    environment.unknownFields['provider.toolLimit'] = 200;
    expect(knownToolLimit(environment)).toEqual({ value: 200, source: 'provider.toolLimit' });
  });
});
