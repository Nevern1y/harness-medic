import path from 'node:path';
import { contextFromOptions, numericOption, type CommonCliOptions } from '../options.js';
import { scanWorkspace } from '../../core/scan.js';
import { scoreFindings } from '../../core/scoring.js';
import { createBaselineSnapshot, writeBaselineSnapshot, readBaselineSnapshot, compareBaseline, defaultBaselinePath, baselineDigest } from '../../baseline/index.js';
import { probeApprovedServers } from '../../probes/mcp.js';
import { formatJson } from '../../reporters/json.js';
import { redactText } from '../../core/redaction.js';

export async function runBaselineCommand(options: CommonCliOptions): Promise<number> {
  const context = contextFromOptions(options, options.probe === true);
  const execution = await scanWorkspace({ cwd: context.cwd, home: context.home, selectedHarnesses: context.selectedHarnesses, envNames: context.envNames, platform: context.platform, scanTier: context.scanTier, consentPolicy: context.consentPolicy });
  let interrupted = false;
  const controller = options.probe ? new AbortController() : undefined;
  const onSigint = (): void => { interrupted = true; controller?.abort(); };
  if (controller) process.once('SIGINT', onSigint);
  try {
    if (options.probe) await addProbeObservations(execution.report, context, execution.services, options, controller?.signal);
  } finally {
    if (controller) process.removeListener('SIGINT', onSigint);
  }
  if (interrupted) return 130;
  if (options.compare) {
    const baseline = await readBaselineSnapshot(path.resolve(options.compare));
    const comparison = compareBaseline(execution.report, baseline);
    execution.report.findings.push(...comparison.findings);
    execution.report.internalDiagnostics.push(...comparison.diagnostics.map((message, index) => ({ id: `baseline:${index}`, phase: 'baseline' as const, message, recoverable: true })));
    execution.report.summary = scoreFindings(execution.report.findings, options.score !== false);
    if (options.format === 'json') process.stdout.write(formatJson(execution.report));
    else process.stdout.write(`Baseline ${redactText(options.compare)}\n${comparison.changed ? `${comparison.findings.length} drift finding(s)` : 'No observed drift'}\n${comparison.diagnostics.map(redactText).join('\n')}${comparison.diagnostics.length > 0 ? '\n' : ''}`);
    return comparison.changed ? 1 : 0;
  }
  const output = path.resolve(options.path ?? defaultBaselinePath(context.cwd));
  const snapshot = createBaselineSnapshot(execution.report);
  await writeBaselineSnapshot(output, snapshot);
  if (options.format === 'json') process.stdout.write(`${JSON.stringify({ path: redactText(output), digest: baselineDigest(snapshot), schemaVersion: 1 })}\n`);
  else process.stdout.write(`Baseline written to ${redactText(output)}\nDigest ${baselineDigest(snapshot)}\n`);
  return 0;
}

async function addProbeObservations(report: import('../../core/model.js').ScanReport, context: import('../../core/model.js').ScanContext, services: import('../../core/model.js').ScanServices, options: CommonCliOptions, signal?: AbortSignal): Promise<void> {
  const timeoutMs = numericOption(options.timeout, 10_000, 1);
  const retries = numericOption(options.retries, 1, 0);
  for (const environment of report.environments) {
    const observations = await probeApprovedServers(environment.mcpServers, context, services, timeoutMs, retries, signal);
    report.observations.push(...observations);
    environment.tools = environment.mcpServers.filter((server) => server.active).flatMap((server) => server.toolInventory?.tools ?? []);
  }
  report.privacy.childProcesses = report.environments.flatMap((environment) => environment.mcpServers).filter((server) => server.transport === 'stdio' && server.observation && server.observation.status !== 'declined' && server.observation.status !== 'not-run').length;
  report.privacy.networkRequests = report.environments.flatMap((environment) => environment.mcpServers).filter((server) => (server.transport === 'sse' || server.transport === 'streamable-http') && server.observation && server.observation.status !== 'declined' && server.observation.status !== 'not-run').length;
  report.privacy.notes.push('Tier 1 MCP probing was explicitly requested for baseline capture; only startup and tools/list were attempted.');
}
