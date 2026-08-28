import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServices, NodeFileSystem } from '../src/core/fs.js';
import type { EffectiveEnvironment, ScanContext, ScanServices } from '../src/core/model.js';

export interface TempFixture {
  root: string;
  workspace: string;
  home: string;
  services: ScanServices;
  cleanup(): Promise<void>;
}

export async function makeFixture(files: Record<string, string> = {}): Promise<TempFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-medic-test-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  const services = createServices(new NodeFileSystem());
  return { root, workspace, home, services, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

export function contextFor(fixture: TempFixture, overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    cwd: fixture.workspace,
    home: fixture.home,
    platform: process.platform,
    envNames: Object.keys(process.env).sort(),
    selectedHarnesses: ['claude-code', 'codex', 'opencode', 'cursor'],
    scanTier: 0,
    consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false },
    ...overrides,
  };
}

export function emptyEnvironment(harness: EffectiveEnvironment['harness'] = 'claude-code', workspace = 'C:/workspace'): EffectiveEnvironment {
  return {
    harness,
    adapterVersion: 'test/1',
    workspace,
    detected: true,
    sources: [],
    activeSourceIds: [],
    shadowEdges: [],
    coverageGaps: [],
    instructions: [],
    mcpServers: [],
    tools: [],
    hooks: [],
    subagents: [],
    permissions: [],
    unknownFields: {},
  };
}
