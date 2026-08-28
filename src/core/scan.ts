import { sha256 } from './fs.js';
import { allChecks } from '../checks/index.js';
import { discoverEnvironments, hasSupportedEnvironment } from '../discovery/index.js';
import { createScanContext, createServices } from './fs.js';
import { runChecks } from './checks.js';
import { scoreFindings } from './scoring.js';
import type { CheckServices, FileSystem, Finding, HarnessId, ScanContext, ScanReport, ScanServices } from './model.js';

export const TOOL_VERSION = '0.1.0';

export interface ScanOptions extends Partial<Omit<ScanContext, 'consentPolicy'>> {
  consentPolicy?: Partial<ScanContext['consentPolicy']>;
  noScore?: boolean;
  services?: ScanServices;
  fs?: FileSystem;
}

export interface ScanExecution {
  report: ScanReport;
  context: ScanContext;
  services: ScanServices;
}

export async function scanWorkspace(options: ScanOptions = {}): Promise<ScanExecution> {
  const baseContext = createScanContext();
  const context = createScanContext({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.home !== undefined ? { home: options.home } : {}),
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.envNames !== undefined ? { envNames: options.envNames } : {}),
    ...(options.selectedHarnesses !== undefined ? { selectedHarnesses: options.selectedHarnesses } : {}),
    ...(options.scanTier !== undefined ? { scanTier: options.scanTier } : {}),
    consentPolicy: { ...baseContext.consentPolicy, ...(options.consentPolicy ?? {}) },
  });
  const services = options.services ?? createServices(options.fs, context.platform);
  const started = services.now();
  const scanId = `scan:${sha256(`${context.cwd}|${context.home}|${context.platform}|${context.selectedHarnesses.join(',')}|${context.scanTier}`).slice(0, 16)}`;
  const discovery = await discoverEnvironments(context, services);
  const checkServices: CheckServices = {
    resolveExecutable: services.resolveExecutable,
    now: services.now,
    envNames: context.envNames,
    fs: services.fs,
    platform: context.platform,
    scanTier: context.scanTier,
  };
  const checks = await runChecks(discovery.environments, allChecks, checkServices);
  const summary = scoreFindings(checks.findings, !options.noScore);
  const finished = services.now();
  const report: ScanReport = {
    schemaVersion: 1,
    tool: { name: 'harness-medic', version: TOOL_VERSION },
    scan: { id: scanId, startedAt: started.toISOString(), durationMs: Math.max(0, finished.getTime() - started.getTime()), tier: context.scanTier },
    workspace: context.cwd,
    privacy: { redacted: true, valuesSerialized: false, networkRequests: 0, childProcesses: 0, notes: ['Tier 0 reads configuration only; configured commands and network transports were not executed.'] },
    coverage: discovery.runs.map((run) => {
      const environment = run.environment;
      return {
        harness: run.adapter.id,
        detected: run.detection.installed,
        parsed: run.parsedSources.some((parsed) => parsed.source.parseStatus === 'parsed'),
        precedenceModeled: Boolean(environment),
        runtimeProbed: Boolean(environment?.mcpServers.some((server) => server.observation && server.observation.status !== 'not-run')),
        behaviorObserved: false,
        gaps: environment?.coverageGaps ?? [],
      };
    }),
    environments: discovery.environments,
    observations: discovery.environments.flatMap((environment) => environment.mcpServers.flatMap((server) => server.observation ? [server.observation] : [])),
    findings: checks.findings,
    summary,
    fixPlans: [],
    internalDiagnostics: [...discovery.internalDiagnostics, ...checks.internalDiagnostics],
  };
  if (!hasSupportedEnvironment(discovery.environments)) {
    report.internalDiagnostics.push({ id: 'scan:no-environment', phase: 'discovery', message: 'No supported harness configuration or installation evidence was found.', recoverable: true });
  }
  return { report, context, services };
}

export function selectedHarnesses(value: string | undefined): HarnessId[] {
  if (!value || value.trim().length === 0 || value === 'all') return ['claude-code', 'codex', 'opencode', 'cursor'];
  const selected = value.split(',').map((entry) => entry.trim()).filter((entry): entry is HarnessId => ['claude-code', 'codex', 'opencode', 'cursor'].includes(entry));
  return selected.length > 0 ? [...new Set(selected)] : ['claude-code', 'codex', 'opencode', 'cursor'];
}

export function failureThresholdMet(report: ScanReport, threshold: 'critical' | 'error' | 'warning' | 'never'): boolean {
  if (threshold === 'never') return false;
  const rank: Record<Finding['severity'] | 'never', number> = { critical: 0, error: 1, warning: 2, info: 3, never: 99 };
  const target = rank[threshold];
  return report.findings.some((finding) => finding.applicable && rank[finding.severity] <= target);
}

export function exitCodeForReport(report: ScanReport, threshold: 'critical' | 'error' | 'warning' | 'never'): number {
  if (failureThresholdMet(report, threshold)) return 1;
  if (report.internalDiagnostics.some((diagnostic) => !diagnostic.recoverable)) return 3;
  if (report.environments.every((environment) => !environment.detected && environment.sources.length === 0)) return 3;
  return 0;
}
