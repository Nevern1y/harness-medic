import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HARNESS_IDS } from '../src/core/model.js';
import { scanWorkspace } from '../src/core/scan.js';
import { readBenchmarkPack, readRecordedTrials, summarizeBenchmark } from '../src/benchmark/index.js';

const args = process.argv.slice(2);
const packIndex = args.indexOf('--pack');
const fixtureIndex = args.indexOf('--fixture');
const packArgument = packIndex >= 0 ? args[packIndex + 1] : undefined;
const fixtureArgument = fixtureIndex >= 0 ? args[fixtureIndex + 1] : undefined;
const packPath = path.resolve(packArgument || 'benchmark-packs/default.json');
const pack = await readBenchmarkPack(packPath);
const trials = fixtureArgument ? await readRecordedTrials(path.resolve(fixtureArgument)) : [];
const summary = summarizeBenchmark(pack, trials);
const performanceReport = await measureTierZeroPerformance();
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  packId: summary.packId,
  scenarioCount: summary.scenarios.length,
  observedScenarios: summary.scenarios.filter((scenario) => scenario.status === 'observed').length,
  trials: summary.trials.length,
  scenarios: summary.scenarios,
  performance: performanceReport,
  note: trials.length === 0 ? 'No harness was launched; provide --fixture for recorded behavioral evidence.' : undefined,
}, null, 2)}\n`);

async function measureTierZeroPerformance(): Promise<{
  samples: number;
  fixture: PerformanceMeasurement;
  workspace10k: PerformanceMeasurement;
  targetsMs: { fixtureP95: number; workspace10kP95: number };
  pass: boolean;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-medic-benchmark-'));
  try {
    const fixtureWorkspace = path.join(root, 'fixture-workspace');
    const fixtureHome = path.join(root, 'fixture-home');
    const largeWorkspace = path.join(root, 'workspace-10k');
    const largeHome = path.join(root, 'home-10k');
    await Promise.all([fs.mkdir(fixtureWorkspace, { recursive: true }), fs.mkdir(fixtureHome, { recursive: true }), fs.mkdir(largeWorkspace, { recursive: true }), fs.mkdir(largeHome, { recursive: true })]);
    for (let start = 0; start < 10_000; start += 128) {
      const end = Math.min(10_000, start + 128);
      await Promise.all(Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        return fs.writeFile(path.join(largeWorkspace, `file-${String(index).padStart(5, '0')}.txt`), 'fixture\n', 'utf8');
      }));
    }

    const fixture = await measureScan(fixtureWorkspace, fixtureHome);
    const workspace10k = await measureScan(largeWorkspace, largeHome);
    const targetsMs = { fixtureP95: 500, workspace10kP95: 2_000 };
    const pass = fixture.p95Ms <= targetsMs.fixtureP95 && workspace10k.p95Ms <= targetsMs.workspace10kP95;
    if (!pass) throw new Error(`Tier 0 performance gate failed: fixture p95 ${fixture.p95Ms}ms, 10k-file p95 ${workspace10k.p95Ms}ms`);
    return { samples: fixture.samples, fixture, workspace10k, targetsMs, pass };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

interface PerformanceMeasurement {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

async function measureScan(cwd: string, home: string): Promise<PerformanceMeasurement> {
  const options = {
    cwd,
    home,
    platform: process.platform,
    envNames: [],
    selectedHarnesses: [...HARNESS_IDS],
    consentPolicy: { interactive: false, allowNetwork: false, allowServers: [], allowHooks: false, allowUntrusted: false },
  };
  await scanWorkspace(options);
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    await scanWorkspace(options);
    samples.push(Math.max(0, performance.now() - started));
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: samples.length,
    p50Ms: roundMs(sorted[Math.floor(sorted.length / 2)] ?? 0),
    p95Ms: roundMs(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0),
    maxMs: roundMs(sorted[sorted.length - 1] ?? 0),
  };
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
