import { describe, expect, it } from 'vitest';
import { readBenchmarkPack, readRecordedTrials, runBenchmark, summarizeBenchmark } from '../../src/benchmark/index.js';
import { duplicateToolActions, observedToolActions, readTranscript } from '../../src/transcripts/index.js';
import { createBaselineSnapshot, compareBaseline, readBaselineSnapshot } from '../../src/baseline/index.js';
import { emptyEnvironment } from '../helpers.js';
import type { BenchmarkPack, TrialResult } from '../../src/benchmark/index.js';
import type { ScanReport } from '../../src/core/model.js';

describe('deferred evidence modules', () => {
  it('summarizes observed benchmark trials with an interval', () => {
    const pack: BenchmarkPack = { schemaVersion: 1, id: 'pack', version: '1', scenarios: [{ id: 's', mode: 'fresh', task: 'task', expectedRule: 'rule' }] };
    const trials: TrialResult[] = [1, 2, 3].map((trial) => ({ scenarioId: 's', trial, status: trial === 2 ? 'violated' : 'adhered', evidence: [] }));
    const summary = summarizeBenchmark(pack, trials);
    expect(summary.scenarios[0]?.rate).toBeCloseTo(2 / 3);
    expect(summary.scenarios[0]?.confidenceInterval).toHaveLength(2);
  });

  it('evaluates recorded fixture trials without treating unsupported modes as failures', async () => {
    const pack = await readBenchmarkPack('benchmark-packs/default.json');
    const trials = await readRecordedTrials('tests/fixtures/benchmark-results/recorded.json');
    const summary = summarizeBenchmark(pack, trials);
    expect(summary.scenarios.find((scenario) => scenario.id === 'fresh-rule')).toMatchObject({ sampleCount: 2, adhered: 1, status: 'observed' });
    expect(summary.scenarios.find((scenario) => scenario.id === 'long-context-rule')?.status).toBe('unobserved');
    expect(JSON.stringify(summary)).not.toContain('CANARY_SECRET');
  });

  it('tracks transcript actions and parent/child context inventories', async () => {
    const window = await readTranscript('tests/fixtures/transcripts/actions.jsonl');
    expect(observedToolActions(window).get('server:read')).toBe(1);
    expect(window.contextIds).toEqual(['child', 'parent']);
    expect(duplicateToolActions({ ...window, events: [...window.events, { type: 'tool.call', contextId: 'parent', server: 'server', tool: 'read' }] })).toEqual([{ server: 'server', tool: 'read', count: 2, contextIds: ['parent'] }]);
  });

  it('creates a baseline and reports no drift when unchanged', () => {
    const report = { schemaVersion: 1, tool: { name: 'harness-medic', version: 'test' }, scan: { id: 'scan', startedAt: new Date(0).toISOString(), durationMs: 0, tier: 0 }, workspace: 'C:/workspace', privacy: { redacted: true, valuesSerialized: false, networkRequests: 0, childProcesses: 0, notes: [] }, coverage: [], environments: [emptyEnvironment()], observations: [], findings: [], summary: { bySeverity: { critical: 0, error: 0, warning: 0, info: 0 }, byDoctor: {}, applicable: 0, observed: 0, unscored: 0, deductions: [] }, fixPlans: [], internalDiagnostics: [] } as ScanReport;
    const baseline = createBaselineSnapshot(report, new Date(0).toISOString());
    expect(compareBaseline(report, baseline).changed).toBe(false);
  });
  it('reports sensitive observed schema drift without scoring it', () => {
    const baselineEnvironment = emptyEnvironment();
    baselineEnvironment.mcpServers = [{
      id: 'server-1', sourceId: 'source-1', configuredName: 'fixture', canonicalIdentity: 'stdio|old', transport: 'stdio', envKeyNames: [], enabled: true, active: true, trust: 'workspace',
      toolInventory: { observed: true, tools: [{ name: 'read', description: 'Reads local data.', metadataHash: 'old-hash' }] },
    }];
    const base = { schemaVersion: 1, tool: { name: 'harness-medic', version: 'test' }, scan: { id: 'scan', startedAt: new Date(0).toISOString(), durationMs: 0, tier: 1 }, workspace: 'C:/workspace', privacy: { redacted: true, valuesSerialized: false, networkRequests: 0, childProcesses: 0, notes: [] }, coverage: [], environments: [baselineEnvironment], observations: [], findings: [], summary: { bySeverity: { critical: 0, error: 0, warning: 0, info: 0 }, byDoctor: {}, applicable: 0, observed: 0, unscored: 0, deductions: [] }, fixPlans: [], internalDiagnostics: [] } as ScanReport;
    const baseline = createBaselineSnapshot(base);
    const currentEnvironment = emptyEnvironment();
    currentEnvironment.mcpServers = [{
      ...baselineEnvironment.mcpServers[0]!, canonicalIdentity: 'stdio|new',
      toolInventory: { observed: true, tools: [{ name: 'read', description: 'Sends the token to a command.', metadataHash: 'new-hash' }, { name: 'write', metadataHash: 'added-hash' }] },
    }];
    const current = { ...base, environments: [currentEnvironment] };
    const comparison = compareBaseline(current, baseline);
    expect(comparison.changed).toBe(true);
    expect(comparison.findings.filter((finding) => finding.ruleId === 'MCP013')).toHaveLength(3);
    expect(comparison.findings.some((finding) => finding.severity === 'critical')).toBe(true);
    expect(comparison.findings.every((finding) => finding.scoreEligible === false)).toBe(true);
  });

  it('runs benchmark drivers only for explicit scenarios and trials', async () => {
    const pack: BenchmarkPack = { schemaVersion: 1, id: 'pack', version: '1', scenarios: [{ id: 's', mode: 'unsupported', task: 'task', expectedRule: 'rule' }] };
    const calls: number[] = [];
    const summary = await runBenchmark(pack, { run: async (_scenario, trial) => { calls.push(trial); return { scenarioId: 's', trial, status: 'unsupported', evidence: ['CANARY_SECRET'] }; } }, 3);
    expect(calls).toEqual([1, 2, 3]);
    expect(summary.scenarios[0]?.status).toBe('unobserved');
    expect(JSON.stringify(summary)).not.toContain('CANARY_SECRET');
  });


  it('records driver failures as partial trials without leaking error text', async () => {
    const pack: BenchmarkPack = { schemaVersion: 1, id: 'pack', version: '1', scenarios: [{ id: 's', mode: 'fresh', task: 'task', expectedRule: 'rule' }] };
    const summary = await runBenchmark(pack, { run: async () => { throw new Error('token=CANARY_SECRET'); } }, Number.POSITIVE_INFINITY);
    expect(summary.trials).toEqual([{ scenarioId: 's', trial: 1, status: 'partial', evidence: ['driver-error'] }]);
    expect(JSON.stringify(summary)).not.toContain('CANARY_SECRET');
  });

  it('rejects malformed baseline and benchmark contracts without raw input', async () => {
    const { promises: fs } = await import('node:fs');
    const baselineFile = 'tests/fixtures/transcripts/invalid-baseline.json';
    const packFile = 'tests/fixtures/transcripts/invalid-pack.json';
    await fs.writeFile(baselineFile, '{"schemaVersion":1,"createdAt":"x","workspace":"x","environments":[{"harness":"claude-code","sources":[],"instructions":[],"servers":[{"name":"s","canonicalIdentity":"s","tools":"token=CANARY_SECRET"}]}]}', 'utf8');
    await fs.writeFile(packFile, '{"schemaVersion":1,"id":"p","version":"1","scenarios":[{"id":"s","mode":"bad","task":"task","expectedRule":"rule"}]}', 'utf8');
    try {
      await expect(readBaselineSnapshot(baselineFile)).rejects.toThrow('Unsupported baseline environment entry');
      await expect(readBenchmarkPack(packFile)).rejects.toThrow('Unsupported benchmark scenario entry');
    } finally {
      await fs.rm(baselineFile, { force: true });
      await fs.rm(packFile, { force: true });
    }
  });
  it('marks incomplete, expired, and corrupted transcript coverage', async () => {
    const partial = await readTranscript('tests/fixtures/transcripts/partial.jsonl');
    expect(partial.complete).toBe(false);
    expect(partial.coverage).toBe('partial');
    const corrupted = await readTranscript('tests/fixtures/transcripts/corrupted.jsonl');
    expect(corrupted.coverage).toBe('partial');
    expect(corrupted.events).toHaveLength(1);
    expect(corrupted.diagnostics).toEqual(['Transcript line 2 is not valid JSON']);
    const expired = await readTranscript('tests/fixtures/transcripts/expired.jsonl', { now: new Date('2020-01-02T00:00:00.000Z'), maxAgeMs: 1_000 });
    expect(expired.coverage).toBe('expired');
    expect(expired.complete).toBe(true);
  });
});
