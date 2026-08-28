import pc from 'picocolors';
import { redactText } from '../core/redaction.js';
import type { ScanReport, Severity } from '../core/model.js';

export interface TerminalOptions {
  color?: boolean;
  verbose?: boolean;
}

export function formatTerminal(report: ScanReport, options: TerminalOptions = {}): string {
  const color = options.color ?? true;
  const paint = (value: string, style: 'red' | 'yellow' | 'cyan' | 'dim' | 'bold') => {
    if (!color) return value;
    if (style === 'red') return pc.red(value);
    if (style === 'yellow') return pc.yellow(value);
    if (style === 'cyan') return pc.cyan(value);
    if (style === 'bold') return pc.bold(value);
    return pc.dim(value);
  };
  const lines: string[] = [];
  lines.push(paint('HARNESS MEDIC', 'bold'));
  lines.push(`Workspace  ${redactText(report.workspace)}`);
  lines.push(`Coverage   ${report.coverage.map((entry) => `${entry.harness} ${coverageLabel(entry)}`).join(' | ')}`);
  const probeStatus = report.observations.length > 0 ? `${report.observations.filter((observation) => observation.status === 'observed').length} observation(s)` : 'not run (use `harness-medic mcp --probe`)';
  lines.push(`Probes     ${probeStatus}`);
  lines.push('');
  const counts = report.summary.bySeverity;
  lines.push(`Health     ${counts.critical} critical · ${counts.error} errors · ${counts.warning} warnings · ${counts.info} info`);
  if (report.summary.healthIndex !== undefined) lines.push(`Index      ${report.summary.healthIndex}/100 (${report.summary.applicable} applicable; ${report.summary.unscored} unscored)`);
  else lines.push(`Index      disabled (${report.summary.unscored} unscored)`);
  lines.push('');
  for (const finding of report.findings) {
    lines.push(`${paint(redactText(finding.severity.toUpperCase()), severityStyle(finding.severity))} ${redactText(finding.ruleId)} ${redactText(finding.title)}`);
    lines.push(`  ${redactText(finding.summary)}`);
    lines.push(`  Impact   ${redactText(finding.impact)}`);
    lines.push(`  Evidence ${finding.evidence.map((item) => redactText(item.summary)).join('; ') || 'none'}`);
    lines.push(`  Fix      ${redactText(finding.remediation)} [${redactText(finding.fixSafety)}]`);
    if (finding.locations.length > 0) lines.push(`  Source   ${finding.locations.map((location) => redactText(location.path)).join('; ')}`);
  }
  if (report.findings.length === 0) lines.push(paint('No findings.', 'cyan'));
  if (report.internalDiagnostics.length > 0) {
    lines.push('');
    lines.push(paint(`Diagnostics ${report.internalDiagnostics.length}`, 'yellow'));
    if (options.verbose) for (const diagnostic of report.internalDiagnostics) lines.push(`  ${redactText(diagnostic.phase)}: ${redactText(diagnostic.message)}`);
  }
  return `${lines.join('\n')}\n`;
}

function severityStyle(severity: Severity): 'red' | 'yellow' | 'cyan' | 'dim' {
  if (severity === 'critical' || severity === 'error') return 'red';
  if (severity === 'warning') return 'yellow';
  if (severity === 'info') return 'cyan';
  return 'dim';
}

function coverageLabel(entry: ScanReport['coverage'][number]): string {
  if (!entry.detected) return 'not detected';
  if (!entry.parsed) return 'parse unavailable';
  if (entry.runtimeProbed) return 'runtime observed';
  return entry.precedenceModeled ? 'static' : 'discovered';
}
