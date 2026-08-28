import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../../src/core/scan.js';
import { probeApprovedServers } from '../../src/probes/mcp.js';
import { makeFixture } from '../helpers.js';

function firstServer(execution: Awaited<ReturnType<typeof scanWorkspace>>) {
  const server = execution.report.environments[0]?.mcpServers[0];
  if (!server) throw new Error('fixture MCP server was not discovered');
  return server;
}

describe('MCP probes', () => {
  it('probes only an explicitly approved stdio server and records tool metadata', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/success.mjs');
    const config = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [serverPath], cwd: fixture.workspace } } });
    const configPath = path.join(fixture.workspace, '.claude.json');
    const fs = await import('node:fs/promises');
    await fs.writeFile(configPath, `${config}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = execution.report.environments[0]?.mcpServers[0];
      expect(server).toBeDefined();
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['fixture'] } };
      const observations = await probeApprovedServers([server!], context, execution.services, 5_000, 0);
      expect(observations[0]?.status).toBe('observed');
      expect(observations[0]?.cleanupStatus).toBe('clean');
      expect(server?.toolInventory?.tools.map((tool) => tool.name)).toEqual(['read_fixture']);
      expect(server?.toolInventory?.observed).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('passes configured stdio environment values without serializing them', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/env-check.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { envcheck: { command: process.execPath, args: [serverPath], env: { FIXTURE_SECRET: 'CANARY_SECRET' } } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = firstServer(execution);
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['envcheck'] } };
      const observation = (await probeApprovedServers([server], context, execution.services, 3_000, 0))[0]!;
      expect(observation.status).toBe('observed');
      expect(JSON.stringify(server)).not.toContain('CANARY_SECRET');
    } finally {
      await fixture.cleanup();
    }
  });

  it('declines an unapproved server without spawning it', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/success.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [serverPath] } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = execution.report.environments[0]?.mcpServers[0];
      const observations = await probeApprovedServers([server!], execution.context, execution.services, 100, 0);
      expect(observations[0]?.status).toBe('declined');
      expect(observations[0]?.attempts).toBe(0);
      expect(server?.toolInventory?.observed).not.toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('retries a transient fixture failure and records both attempts', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/transient.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { transient: { command: process.execPath, args: [serverPath], cwd: fixture.workspace } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = firstServer(execution);
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['transient'] } };
      const observations = await probeApprovedServers([server], context, execution.services, 3_000, 1);
      expect(observations[0]?.status).toBe('observed');
      expect(observations[0]?.attempts).toBe(2);
      expect(server.toolInventory?.tools.map((tool) => tool.name)).toEqual(['read_transient']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed on malformed tools/list metadata and cleans up', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/malformed.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { malformed: { command: process.execPath, args: [serverPath], cwd: fixture.workspace } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = firstServer(execution);
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['malformed'] } };
      const observation = (await probeApprovedServers([server], context, execution.services, 3_000, 0))[0]!;
      expect(observation.status).toBe('failed');
      expect(observation.cleanupStatus).toBe('clean');
      expect(server.toolInventory?.observed).not.toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('times out a hanging fixture and leaves no server process', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/hanging.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { hanging: { command: process.execPath, args: [serverPath], cwd: fixture.workspace } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = firstServer(execution);
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['hanging'] } };
      const observation = (await probeApprovedServers([server], context, execution.services, 100, 0))[0]!;
      expect(observation.status).toBe('timed-out');
      expect(observation.cleanupStatus).toBe('clean');
    } finally {
      await fixture.cleanup();
    }
  });

  it('terminates a fixture child process with its MCP parent', async () => {
    const fixture = await makeFixture({});
    const serverPath = path.resolve('tests/fixtures/mcp-servers/child.mjs');
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(fixture.workspace, '.claude.json'), `${JSON.stringify({ mcpServers: { child: { command: process.execPath, args: [serverPath], cwd: fixture.workspace } } })}\n`, 'utf8');
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] });
      const server = firstServer(execution);
      const context = { ...execution.context, consentPolicy: { ...execution.context.consentPolicy, allowServers: ['child'] } };
      const observation = (await probeApprovedServers([server], context, execution.services, 3_000, 0))[0]!;
      expect(observation.status).toBe('observed');
      expect(observation.cleanupStatus).toBe('clean');
      const childPid = Number(await fs.readFile(path.join(fixture.workspace, '.harness-medic-child.pid'), 'utf8'));
      let alive = true;
      try { process.kill(childPid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
