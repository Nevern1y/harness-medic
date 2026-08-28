import { promises as nodeFs } from 'node:fs';
import { redactValue, redactText } from '../core/redaction.js';

export interface BenchmarkScenario {
  id: string;
  mode: 'fresh' | 'long-context' | 'compacted' | 'subagent' | 'unsupported';
  task: string;
  expectedRule: string;
}

export interface BenchmarkPack {
  schemaVersion: 1;
  id: string;
  version: string;
  scenarios: BenchmarkScenario[];
}

export interface TrialResult {
  scenarioId: string;
  trial: number;
  status: 'adhered' | 'violated' | 'unsupported' | 'interrupted' | 'partial';
  evidence: string[];
}

export interface BenchmarkSummary {
  schemaVersion: 1;
  packId: string;
  scenarios: Array<{ id: string; mode: string; sampleCount: number; adhered: number; rate?: number; confidenceInterval?: [number, number]; status: string }>;
  trials: TrialResult[];
  redacted: true;
}

export interface BenchmarkDriver {
  run(scenario: BenchmarkScenario, trial: number): Promise<TrialResult>;
}

export async function readBenchmarkPack(filePath: string): Promise<BenchmarkPack> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await nodeFs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Benchmark pack is not valid JSON', { cause: error });
    throw error;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.id !== 'string' || parsed.id.length === 0 || typeof parsed.version !== 'string' || parsed.version.length === 0 || !Array.isArray(parsed.scenarios)) throw new Error('Unsupported benchmark pack schema');
  const scenarios = parsed.scenarios.filter(isScenario);
  if (scenarios.length !== parsed.scenarios.length || new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) throw new Error('Unsupported benchmark scenario entry');
  return { schemaVersion: 1, id: redactText(parsed.id), version: redactText(parsed.version), scenarios: scenarios.map((scenario) => ({ ...scenario, id: redactText(scenario.id), task: redactText(scenario.task), expectedRule: redactText(scenario.expectedRule) })) };
}

export async function readRecordedTrials(filePath: string): Promise<TrialResult[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await nodeFs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Recorded benchmark fixture is not valid JSON', { cause: error });
    throw error;
  }
  const values = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.trials) ? parsed.trials : [];
  return values.flatMap((value) => {
    if (!isRecord(value) || typeof value.scenarioId !== 'string' || typeof value.trial !== 'number' || !Number.isInteger(value.trial) || value.trial < 1 || typeof value.status !== 'string') return [];
    const status = trialStatuses.includes(value.status as TrialResult['status']) ? value.status as TrialResult['status'] : 'partial';
    return [{ scenarioId: redactText(value.scenarioId), trial: value.trial, status, evidence: Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === 'string').map(redactText) : [] }];
  });
}

const scenarioModes: BenchmarkScenario['mode'][] = ['fresh', 'long-context', 'compacted', 'subagent', 'unsupported'];
const trialStatuses: TrialResult['status'][] = ['adhered', 'violated', 'unsupported', 'interrupted', 'partial'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScenario(value: unknown): value is BenchmarkScenario {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.mode === 'string' && scenarioModes.includes(value.mode as BenchmarkScenario['mode']) && typeof value.task === 'string' && value.task.length > 0 && typeof value.expectedRule === 'string' && value.expectedRule.length > 0;
}


export async function runBenchmark(pack: BenchmarkPack, driver: BenchmarkDriver, trialsPerScenario: number): Promise<BenchmarkSummary> {
  const trials: TrialResult[] = [];
  const count = Number.isFinite(trialsPerScenario) ? Math.max(1, Math.min(1000, Math.floor(trialsPerScenario))) : 1;
  for (const scenario of pack.scenarios) {
    for (let trial = 1; trial <= count; trial += 1) {
      try {
        trials.push(normalizeTrial(scenario, trial, await driver.run(scenario, trial)));
      } catch {
        trials.push({ scenarioId: scenario.id, trial, status: 'partial', evidence: ['driver-error'] });
      }
    }
  }
  return summarizeBenchmark(pack, trials);
}

function normalizeTrial(scenario: BenchmarkScenario, trial: number, value: TrialResult): TrialResult {
  const status = trialStatuses.includes(value.status) ? value.status : 'partial';
  return {
    scenarioId: scenario.id,
    trial,
    status,
    evidence: Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === 'string').map(redactText) : [],
  };
}

export function summarizeBenchmark(pack: BenchmarkPack, trials: TrialResult[]): BenchmarkSummary {
  const scenarios = pack.scenarios.map((scenario) => {
    const results = trials.filter((trial) => trial.scenarioId === scenario.id);
    const adhered = results.filter((trial) => trial.status === 'adhered').length;
    const observed = results.filter((trial) => trial.status === 'adhered' || trial.status === 'violated');
    const interval = observed.length > 0 ? wilsonInterval(adhered, observed.length) : undefined;
    return { id: scenario.id, mode: scenario.mode, sampleCount: results.length, adhered, ...(observed.length > 0 ? { rate: adhered / observed.length, confidenceInterval: interval } : {}), status: observed.length === 0 ? 'unobserved' : 'observed' };
  });
  return { schemaVersion: 1, packId: pack.id, scenarios, trials: trials.map((trial) => redactValue(trial) as TrialResult), redacted: true };
}

function wilsonInterval(successes: number, samples: number): [number, number] {
  const z = 1.96;
  const p = successes / samples;
  const denominator = 1 + (z * z) / samples;
  const center = (p + (z * z) / (2 * samples)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p) / samples) + (z * z) / (4 * samples * samples))) / denominator;
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}
