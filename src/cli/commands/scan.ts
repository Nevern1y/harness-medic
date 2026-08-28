import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { contextFromOptions, numericOption, type CommonCliOptions } from '../options.js';
import { scanWorkspace, exitCodeForReport } from '../../core/scan.js';
import { runChecks } from '../../core/checks.js';
import { deduplicateFindings } from '../../core/evidence.js';
import { scoreFindings } from '../../core/scoring.js';
import { allChecks } from '../../checks/index.js';
import { formatJson, writeJsonAtomically } from '../../reporters/json.js';
import { formatTerminal } from '../../reporters/terminal.js';
import { probeHook } from '../../probes/hooks.js';
import { probeApprovedServers } from '../../probes/mcp.js';
import type { CheckServices, Finding, ScanContext, ScanReport, ScanServices } from '../../core/model.js';

export interface ScanCommandOptions extends CommonCliOptions {
  doctor?: Finding['doctor'];
}

export async function runScanCommand(options: ScanCommandOptions = {}): Promise<number> {
  const mcpProbe = options.probe === true && (options.doctor === undefined || options.doctor === 'mcp');
  const hookProbe = options.probe === true && options.doctor === 'hooks';
  const activeProbe = mcpProbe || hookProbe;
  const context = contextFromOptions(options, activeProbe);
  const execution = await scanWorkspace({
    cwd: context.cwd,
    home: context.home,
    platform: context.platform,
    envNames: context.envNames,
    selectedHarnesses: context.selectedHarnesses,
    scanTier: context.scanTier,
    consentPolicy: context.consentPolicy,
    noScore: options.score === false,
  });
  let interrupted = false;
  const controller = activeProbe ? new AbortController() : undefined;
  const onSigint = (): void => {
    interrupted = true;
    controller?.abort();
  };
  if (controller) process.once('SIGINT', onSigint);
  try {
    if (mcpProbe) await addMcpProbeObservations(execution.report, execution.context, execution.services, options, controller?.signal);
    if (hookProbe) await addHookProbeObservations(execution.report, execution.context, execution.services);
  } finally {
    if (controller) process.removeListener('SIGINT', onSigint);
  }
  await refreshChecks(execution.report, execution.services, context);
  const report = options.doctor ? filterDoctor(execution.report, options.doctor) : execution.report;
  report.summary = scoreFindings(report.findings, options.score !== false);
  await emitReport(report, options);
  if (options.verbose && report.internalDiagnostics.length > 0) for (const diagnostic of report.internalDiagnostics) process.stderr.write(`[${diagnostic.phase}] ${diagnostic.message}\n`);
  return interrupted ? 130 : exitCodeForReport(report, options.failOn ?? 'warning');
}

async function refreshChecks(report: ScanReport, services: ScanServices, context: ScanContext): Promise<void> {
  const checkServices: CheckServices = { resolveExecutable: services.resolveExecutable, now: services.now, envNames: context.envNames, fs: services.fs, platform: context.platform, scanTier: context.scanTier };
  const rerun = await runChecks(report.environments, allChecks, checkServices);
  report.findings = deduplicateFindings([...report.findings, ...rerun.findings]);
  report.internalDiagnostics.push(...rerun.internalDiagnostics.filter((diagnostic) => !report.internalDiagnostics.some((existing) => existing.id === diagnostic.id)));
}

async function addMcpProbeObservations(report: ScanReport, context: ScanContext, services: ScanServices, options: ScanCommandOptions, signal?: AbortSignal): Promise<void> {
  const timeoutMs = numericOption(options.timeout, 10_000, 1);
  const retries = numericOption(options.retries, 1, 0);
  for (const environment of report.environments) {
    const servers = environment.mcpServers.filter((server) => server.active);
    const observations = await probeApprovedServers(servers, context, services, timeoutMs, retries, signal);
    report.observations.push(...observations);
  }
  for (const environment of report.environments) environment.tools = environment.mcpServers.filter((server) => server.active).flatMap((server) => server.toolInventory?.tools ?? []);
  const allServers = report.environments.flatMap((environment) => environment.mcpServers);
  report.privacy.childProcesses = allServers.filter((server) => server.transport === 'stdio' && server.observation && server.observation.status !== 'declined' && server.observation.status !== 'not-run').length;
  report.privacy.networkRequests = allServers.filter((server) => (server.transport === 'sse' || server.transport === 'streamable-http') && server.observation && server.observation.status !== 'declined' && server.observation.status !== 'not-run').length;
  report.privacy.notes = ['Tier 1 MCP probing was explicitly requested; only startup and tools/list were attempted, tool calls were never executed.'];
  report.scan.durationMs = Math.max(0, services.now().getTime() - new Date(report.scan.startedAt).getTime());
  report.coverage = report.coverage.map((entry) => {
    const environment = report.environments.find((candidate) => candidate.harness === entry.harness);
    return { ...entry, runtimeProbed: Boolean(environment?.mcpServers.some((server) => server.observation && server.observation.status !== 'not-run' && server.observation.status !== 'declined')) };
  });
}

async function addHookProbeObservations(report: ScanReport, context: ScanContext, services: ScanServices): Promise<void> {
  for (const environment of report.environments) {
    for (const hook of environment.hooks.filter((entry) => entry.active)) {
      const observation = await probeHook(hook, context, services);
      hook.observation = observation;
      report.observations.push(observation);
    }
  }
  report.privacy.notes = [...report.privacy.notes, 'Tier 1 hook probing was requested; no harness-native or approved inert synthetic event was available, so hook commands were not executed.'];
  report.scan.durationMs = Math.max(0, services.now().getTime() - new Date(report.scan.startedAt).getTime());
}

function filterDoctor(report: ScanReport, doctor: Finding['doctor']): ScanReport {
  return { ...report, findings: report.findings.filter((finding) => finding.doctor === doctor) };
}

async function emitReport(report: ScanReport, options: ScanCommandOptions): Promise<void> {
  const format = options.format ?? 'terminal';
  if (format !== 'terminal' && format !== 'json') throw new Error(`Unsupported format ${format}`);
  if (format === 'json') {
    if (options.output) await writeJsonAtomically(path.resolve(options.output), report);
    else process.stdout.write(formatJson(report));
    return;
  }
  const output = formatTerminal(report, { color: options.color !== false, verbose: options.verbose });
  if (options.output) {
    await nodeFs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await nodeFs.writeFile(path.resolve(options.output), output, 'utf8');
  } else process.stdout.write(output);
}
