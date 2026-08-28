import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { normalizePathForIdentity, sha256 } from '../core/fs.js';
import { createFinding } from '../core/evidence.js';
import { createRugPullFinding } from '../checks/security/index.js';
import { redactValue } from '../core/redaction.js';
import type { EffectiveEnvironment, Finding, ScanReport } from '../core/model.js';

export interface BaselineSnapshot {
  schemaVersion: 1;
  createdAt: string;
  workspace: string;
  environments: BaselineEnvironment[];
}

export interface BaselineEnvironment {
  harness: EffectiveEnvironment['harness'];
  observedAt?: string;
  sources: Array<{ path: string; contentHash?: string }>;
  instructions: Array<{ path: string; textHash: string; bytes: number }>;
  servers: Array<{ name: string; canonicalIdentity: string; observed?: boolean; tools: Array<{ name: string; metadataHash?: string }> }>;
}

export interface BaselineComparison {
  findings: Finding[];
  changed: boolean;
  diagnostics: string[];
}

export function createBaselineSnapshot(report: ScanReport, createdAt = new Date().toISOString()): BaselineSnapshot {
  return {
    schemaVersion: 1,
    createdAt,
    workspace: report.workspace,
    environments: report.environments.map((environment) => ({
      harness: environment.harness,
      ...(environment.mcpServers.some((server) => server.observation) ? { observedAt: environment.mcpServers.map((server) => server.observation?.startedAt).filter((value): value is string => Boolean(value)).sort().at(-1) } : {}),
      sources: environment.sources.filter((source) => source.parseStatus === 'parsed').map((source) => ({ path: source.path, ...(source.contentHash ? { contentHash: source.contentHash } : {}) })).sort((left, right) => left.path.localeCompare(right.path)),
      instructions: environment.instructions.filter((instruction) => instruction.active).map((instruction) => ({ path: instruction.path, textHash: instruction.textHash, bytes: instruction.bytes })).sort((left, right) => left.path.localeCompare(right.path)),
      servers: environment.mcpServers.filter((server) => server.active).map((server) => ({ name: server.configuredName, canonicalIdentity: server.canonicalIdentity, observed: Boolean(server.toolInventory?.observed), tools: (server.toolInventory?.tools ?? []).map((tool) => ({ name: tool.name, ...(tool.metadataHash ? { metadataHash: tool.metadataHash } : {}) })).sort((left, right) => left.name.localeCompare(right.name)) })).sort((left, right) => left.name.localeCompare(right.name)),
    })),
  };
}

export async function writeBaselineSnapshot(filePath: string, snapshot: BaselineSnapshot): Promise<void> {
  const resolved = path.resolve(filePath);
  await nodeFs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  try {
    await nodeFs.writeFile(temporary, `${JSON.stringify(redactValue(snapshot), null, 2)}\n`, 'utf8');
    await nodeFs.rename(temporary, resolved);
  } finally {
    await nodeFs.unlink(temporary).catch(() => undefined);
  }
}

export async function readBaselineSnapshot(filePath: string): Promise<BaselineSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await nodeFs.readFile(path.resolve(filePath), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Baseline is not valid JSON', { cause: error });
    throw error;
  }
  const sanitized = redactValue(parsed);
  if (!isRecord(sanitized) || sanitized.schemaVersion !== 1 || typeof sanitized.createdAt !== 'string' || typeof sanitized.workspace !== 'string' || !Array.isArray(sanitized.environments)) throw new Error('Unsupported baseline schema');
  const environments = sanitized.environments.filter(isBaselineEnvironment);
  if (environments.length !== sanitized.environments.length || new Set(environments.map((environment) => environment.harness)).size !== environments.length) throw new Error('Unsupported baseline environment entry');
  return { schemaVersion: 1, createdAt: sanitized.createdAt, workspace: sanitized.workspace, environments };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBaselineEnvironment(value: unknown): value is BaselineEnvironment {
  if (!isRecord(value) || !['claude-code', 'codex', 'opencode', 'cursor'].includes(String(value.harness)) || (value.observedAt !== undefined && typeof value.observedAt !== 'string') || !Array.isArray(value.sources) || !Array.isArray(value.instructions) || !Array.isArray(value.servers)) return false;
  const validSources = value.sources.every((source) => isRecord(source) && typeof source.path === 'string' && (source.contentHash === undefined || typeof source.contentHash === 'string'));
  const validInstructions = value.instructions.every((instruction) => isRecord(instruction) && typeof instruction.path === 'string' && typeof instruction.textHash === 'string' && typeof instruction.bytes === 'number' && Number.isInteger(instruction.bytes) && instruction.bytes >= 0);
  const validServers = value.servers.every((server) => isRecord(server) && typeof server.name === 'string' && typeof server.canonicalIdentity === 'string' && (server.observed === undefined || typeof server.observed === 'boolean') && Array.isArray(server.tools) && server.tools.every((tool) => isRecord(tool) && typeof tool.name === 'string' && (tool.metadataHash === undefined || typeof tool.metadataHash === 'string')));
  return validSources && validInstructions && validServers;
}

export function compareBaseline(report: ScanReport, baseline: BaselineSnapshot): BaselineComparison {
  const findings: Finding[] = [];
  const diagnostics: string[] = [];
  const windowsPaths = isWindowsPath(report.workspace) || isWindowsPath(baseline.workspace);
  if (pathKey(baseline.workspace, windowsPaths) !== pathKey(report.workspace, windowsPaths)) diagnostics.push(`Baseline workspace differs from current workspace: ${redactValue(baseline.workspace)}`);
  const baselineByHarness = new Map(baseline.environments.map((environment) => [environment.harness, environment]));
  for (const environment of report.environments) {
    const previous = baselineByHarness.get(environment.harness);
    if (!previous) {
      diagnostics.push(`No baseline environment exists for ${environment.harness}.`);
      continue;
    }

    compareSourceState(environment, previous, diagnostics, windowsPaths);
    compareInstructionState(environment, previous, diagnostics, windowsPaths);

    const previousServers = new Map(previous.servers.map((server) => [server.name, server]));
    const currentServers = new Map(environment.mcpServers.filter((server) => server.active).map((server) => [server.configuredName, server]));
    for (const server of currentServers.values()) {
      const old = previousServers.get(server.configuredName);
      const observed = Boolean(server.toolInventory?.observed);
      if (!old) {
        if (observed) findings.push(...createDriftFindings(environment, server, undefined, undefined, server.canonicalIdentity, `${server.configuredName} was observed but is absent from the selected baseline.`));
        else diagnostics.push(`${server.configuredName} is active but its tool inventory was not observed; no schema comparison was made.`);
        continue;
      }
      if (old.canonicalIdentity !== server.canonicalIdentity) {
        if (observed) findings.push(...createDriftFindings(environment, server, undefined, old.canonicalIdentity, server.canonicalIdentity, `${server.configuredName} now resolves to a different canonical target than the selected baseline.`));
        else diagnostics.push(`${server.configuredName} target identity changed while its current runtime inventory is unobserved.`);
      }
      if (!observed) {
        if (old.observed) diagnostics.push(`${server.configuredName} was observed in the baseline but is not observed in the current scan.`);
        continue;
      }
      if (!old.observed) {
        diagnostics.push(`${server.configuredName} tool inventory was observed for the first time; no schema drift comparison was made.`);
        continue;
      }
      compareToolState(environment, server, old.tools, findings);
    }
    for (const old of previous.servers) {
      if (old.observed && !currentServers.has(old.name)) diagnostics.push(`${old.name} was observed in the baseline but is absent from the current effective configuration.`);
    }
  }
  diagnostics.sort((left, right) => left.localeCompare(right));
  return { findings, changed: findings.length > 0 || diagnostics.length > 0, diagnostics };
}

function compareSourceState(environment: EffectiveEnvironment, previous: BaselineEnvironment, diagnostics: string[], windowsPaths: boolean): void {
  const current = new Map(environment.sources.filter((source) => source.parseStatus === 'parsed').map((source) => [pathKey(source.path, windowsPaths), source.contentHash]));
  const old = new Map(previous.sources.map((source) => [pathKey(source.path, windowsPaths), { display: source.path, contentHash: source.contentHash }]));
  for (const [sourcePath, oldState] of old) {
    if (!current.has(sourcePath)) diagnostics.push(`Source is missing from the current effective environment: ${redactValue(oldState.display)}`);
    else if (oldState.contentHash && current.get(sourcePath) && oldState.contentHash !== current.get(sourcePath)) diagnostics.push(`Source changed: ${redactValue(oldState.display)}`);
  }
  for (const sourcePath of current.keys()) if (!old.has(sourcePath)) diagnostics.push(`Source was added to the current effective environment: ${redactValue(sourcePath)}`);
}

function compareInstructionState(environment: EffectiveEnvironment, previous: BaselineEnvironment, diagnostics: string[], windowsPaths: boolean): void {
  const current = new Map(environment.instructions.filter((instruction) => instruction.active).map((instruction) => [pathKey(instruction.path, windowsPaths), instruction]));
  const old = new Map(previous.instructions.map((instruction) => [pathKey(instruction.path, windowsPaths), { display: instruction.path, instruction }]));
  for (const [instructionPath, oldState] of old) {
    const currentInstruction = current.get(instructionPath);
    if (!currentInstruction) diagnostics.push(`Instruction is missing from the current effective environment: ${redactValue(oldState.display)}`);
    else if (oldState.instruction.textHash !== currentInstruction.textHash || oldState.instruction.bytes !== currentInstruction.bytes) diagnostics.push(`Instruction changed: ${redactValue(oldState.display)}`);
  }
  for (const instructionPath of current.keys()) if (!old.has(instructionPath)) diagnostics.push(`Instruction was added to the current effective environment: ${redactValue(instructionPath)}`);
}

function isWindowsPath(value: string): boolean {
  return process.platform === 'win32' || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');
}

function pathKey(value: string, windowsPaths: boolean): string {
  return normalizePathForIdentity(value, windowsPaths);
}

function compareToolState(environment: EffectiveEnvironment, server: EffectiveEnvironment['mcpServers'][number], previousTools: BaselineEnvironment['servers'][number]['tools'], findings: Finding[]): void {
  const oldTools = new Map(previousTools.map((tool) => [tool.name, tool.metadataHash]));
  const currentTools = new Map((server.toolInventory?.tools ?? []).map((tool) => [tool.name, tool]));
  for (const tool of currentTools.values()) {
    const previousHash = oldTools.get(tool.name);
    if (!oldTools.has(tool.name)) findings.push(...createDriftFindings(environment, server, tool.name, undefined, tool.metadataHash, `${server.configuredName}/${tool.name} was added after the selected baseline.`, isSensitiveTool(tool)));
    else if (previousHash !== tool.metadataHash) findings.push(...createDriftFindings(environment, server, tool.name, previousHash, tool.metadataHash, `${server.configuredName}/${tool.name} metadata changed since the selected baseline.`, isSensitiveTool(tool)));
  }
  const currentNames = new Set(currentTools.keys());
  for (const [toolName, previousHash] of oldTools) if (!currentNames.has(toolName)) findings.push(...createDriftFindings(environment, server, toolName, previousHash, undefined, `${server.configuredName}/${toolName} disappeared from the observed tool inventory.`));
}

function createDriftFindings(environment: EffectiveEnvironment, server: EffectiveEnvironment['mcpServers'][number], toolName: string | undefined, previous: string | undefined, current: string | undefined, summary: string, sensitive = false): Finding[] {
  const label = toolName ? `${server.configuredName}/${toolName}` : server.configuredName;
  const id = `${server.id}:${toolName ?? 'server'}`;
  const marker = { id, label, previous, current, summary, sensitive, sourceId: server.sourceId, ...(server.configLocation ? { location: server.configLocation } : {}) };
  return [createDriftFinding(environment, server, toolName, previous, current, summary, sensitive), createRugPullFinding(environment, marker)];
}

function createDriftFinding(environment: EffectiveEnvironment, server: EffectiveEnvironment['mcpServers'][number], toolName: string | undefined, previous: string | undefined, current: string | undefined, summary: string, sensitive = false): Finding {
  const label = toolName ? `${server.configuredName}/${toolName}` : server.configuredName;
  const transition = `${previous ?? '[absent]'} → ${current ?? '[absent]'}`;
  return createFinding(environment, {
    ruleId: 'MCP013', doctor: 'mcp', severity: sensitive ? 'critical' : 'warning', evidenceClass: 'runtime', confidence: 'certain',
    title: sensitive ? 'Sensitive MCP schema drift' : 'MCP schema drift',
    summary,
    impact: sensitive ? 'A previously approved capability may have gained a sensitive or destructive surface.' : 'Observed MCP metadata or target identity changed after the selected baseline and requires review.',
    evidence: [{ id: `${server.id}:${toolName ?? 'server'}`, kind: 'comparison', summary: `${label}: ${transition}`, sourceId: server.sourceId, evidenceClass: 'runtime' }],
    remediation: 'Review the changed metadata or target, update the baseline only after approval, and do not treat drift as proof of compromise.',
    references: ['https://modelcontextprotocol.io/specification/2025-11-25/server/tools'],
    observed: true,
    scoreEligible: false,
  });
}

function isSensitiveTool(tool: { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown; annotations?: Record<string, unknown> }): boolean {
  return /(?:password|token|secret|credential|api[_-]?key|private[_-]?key|filesystem|command|shell)/i.test(JSON.stringify(tool));
}

export function defaultBaselinePath(workspace: string): string {
  return path.join(workspace, '.harness-medic', 'baseline.json');
}

export function baselineDigest(snapshot: BaselineSnapshot): string {
  return sha256(JSON.stringify(snapshot));
}
