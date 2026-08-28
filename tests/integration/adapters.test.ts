import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../../src/core/scan.js';
import { planFixes } from '../../src/fixes/planner.js';
import { applyFixPlan } from '../../src/fixes/transaction.js';
import { makeFixture } from '../helpers.js';

describe('adapter integration', () => {
  it('reconstructs all four harnesses from one deterministic fixture', async () => {
    const fixture = await makeFixture({
      'workspace/.claude/settings.json': '{"mcpServers":{"claude":{"command":"node","args":["fixture.js"]}},"hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":"node check.js"}]}]}}\n',
      'workspace/.claude/settings.local.json': '{"mcpServers":{"claude":{"command":"node","args":["local.js"]}}}\n',
      'workspace/CLAUDE.md': '# Rules\nAlways run the fixture check.\n',
      'home/.claude/settings.json': '{"model":"fixture-model"}\n',
      'home/.codex/config.toml': '[mcp_servers.fixture]\ncommand = "node"\nargs = ["fixture.js"]\n',
      'workspace/AGENTS.md': '# Shared\nMust preserve the fixture boundary.\n',
      'workspace/opencode.json': '{"mcp":{"fixture":{"command":["node","fixture.js"]}}}\n',
      'workspace/.cursor/mcp.json': '{"mcpServers":{"fixture":{"command":"node","args":["fixture.js"]}}}\n',
      'workspace/.opencode/rules/local.md': 'Do not upload fixture data.\n',
      'workspace/.cursor/rules/local.mdc': 'Always keep fixture data local.\n',
    });
    try {
      const execution = await scanWorkspace({
        cwd: fixture.workspace,
        home: fixture.home,
        platform: process.platform,
        envNames: [],
        selectedHarnesses: ['claude-code', 'codex', 'opencode', 'cursor'],
        consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false },
      });
      expect(execution.report.environments.map((environment) => environment.harness)).toEqual(['claude-code', 'codex', 'opencode', 'cursor']);
      for (const environment of execution.report.environments) {
        expect(environment.detected).toBe(true);
        expect(environment.sources.some((source) => source.parseStatus === 'parsed')).toBe(true);
        expect(environment.coverageGaps.length).toBeGreaterThan(0);
      }
      const claude = execution.report.environments.find((environment) => environment.harness === 'claude-code')!;
      expect(claude.instructions.some((document) => document.path.endsWith('CLAUDE.md'))).toBe(true);
      expect(claude.mcpServers).toHaveLength(2);
      expect(claude.shadowEdges).toHaveLength(1);
      expect(claude.hooks).toHaveLength(1);
      expect(execution.report.privacy.childProcesses).toBe(0);
      expect(execution.report.privacy.networkRequests).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it('reports exact duplicate targets and applies the safe lower-precedence fix', async () => {
    const fixture = await makeFixture({
      'workspace/.claude/settings.json': `{"mcpServers":{"alpha":{"command":${JSON.stringify(process.execPath)},"args":["fixture.js"]}}}\n`,
      'workspace/.mcp.json': `{"mcpServers":{"beta":{"command":${JSON.stringify(process.execPath)},"args":["fixture.js"]}}}\n`,
    });
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, platform: process.platform, envNames: [], selectedHarnesses: ['claude-code'], consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false } });
      expect(execution.report.findings.filter((finding) => finding.ruleId === 'MCP001')).toHaveLength(1);
      const planned = await planFixes(execution.report, execution.services);
      expect(planned.plans).toHaveLength(1);
      expect(planned.plans[0]?.safety).toBe('safe');
      const result = await applyFixPlan(planned.plans[0]!, execution.services, { dryRun: false });
      expect(result.status).toBe('committed');
      const after = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, platform: process.platform, envNames: [], selectedHarnesses: ['claude-code'], consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false }, fs: execution.services.fs });
      expect(after.report.findings.filter((finding) => finding.ruleId === 'MCP001')).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('retains malformed source evidence while isolating the other adapter', async () => {
    const fixture = await makeFixture({
      'workspace/.claude/settings.json': '{ malformed\n',
      'workspace/opencode.json': '{"mcp":{"ok":{"command":"node"}}}\n',
    });
    try {
      const execution = await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, platform: process.platform, envNames: [], selectedHarnesses: ['claude-code', 'opencode'] });
      const claude = execution.report.environments.find((environment) => environment.harness === 'claude-code')!;
      const opencode = execution.report.environments.find((environment) => environment.harness === 'opencode')!;
      expect(claude.sources.some((source) => source.parseStatus === 'invalid')).toBe(true);
      expect(opencode.mcpServers.map((server) => server.configuredName)).toEqual(['ok']);
      expect(claude.sources.find((source) => source.parseStatus === 'invalid')?.diagnostics.length).toBeGreaterThan(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
