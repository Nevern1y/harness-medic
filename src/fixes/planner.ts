import { duplicateGroups } from '../core/mcp/identity.js';
import { readTextFile } from '../core/fs.js';
import { parseContent } from '../parsers/index.js';
import type { EffectiveEnvironment, FileSystem, FixPlan, McpServer, ParsedSource, ScanReport, ScanServices } from '../core/model.js';
import { buildJsonDeleteOperation, mcpJsonPath } from './operations/jsonc.js';

export interface FixPlanningResult {
  plans: FixPlan[];
  diagnostics: string[];
}

export async function planFixes(report: ScanReport, services: ScanServices): Promise<FixPlanningResult> {
  const plans: FixPlan[] = [];
  const diagnostics: string[] = [];
  for (const environment of report.environments) {
    const duplicatePlans = await planDuplicateMcpFixes(environment, report, services, diagnostics);
    plans.push(...duplicatePlans);
  }
  return { plans: plans.sort((left, right) => left.id.localeCompare(right.id)), diagnostics };
}

async function planDuplicateMcpFixes(environment: EffectiveEnvironment, report: ScanReport, services: ScanServices, diagnostics: string[]): Promise<FixPlan[]> {
  const plans: FixPlan[] = [];
  for (const group of duplicateGroups(environment.mcpServers.filter((server) => server.enabled && environment.sources.find((source) => source.id === server.sourceId)?.applicable))) {
    const winner = [...group].sort((left, right) => sourcePriority(environment, right) - sourcePriority(environment, left) || left.id.localeCompare(right.id))[0];
    if (!winner) continue;
    const operations = [];
    for (const server of group) {
      if (server.id === winner.id) continue;
      const source = environment.sources.find((entry) => entry.id === server.sourceId);
      if (!source || (source.parser !== 'json' && source.parser !== 'jsonc')) {
        diagnostics.push(`No parser-preserving deletion is available for ${server.configuredName} at ${source?.path ?? 'unknown source'}.`);
        continue;
      }
      const parsed = await parseForOperation(source, services.fs);
      if (!parsed) {
        diagnostics.push(`Could not read ${source.path} while planning a duplicate fix.`);
        continue;
      }
      operations.push(buildJsonDeleteOperation({ source, parsed, path: mcpJsonPath(source, server), label: `${server.configuredName} duplicate registration` }));
    }
    if (operations.length === 0) continue;
    const findingIds = findingIdsForGroup(reportFindings(report, environment), group);
    const id = `fix-mcp-duplicate-${safeId(winner.configuredName)}-${environment.harness}`;
    plans.push({
      id,
      findingIds,
      safety: 'safe',
      operations,
      preconditions: operations.map((operation) => ({ path: operation.path, contentHash: operation.beforeHash })),
      postconditions: [{ description: 'Deleted duplicate registrations do not reappear in the effective environment', paths: operations.map((operation) => operation.path), ruleIds: ['MCP001'] }],
      affectedPaths: [...new Set(operations.map((operation) => operation.path))].sort(),
      preview: operations.map((operation) => `${operation.description}\n- ${operation.beforeBytes} bytes\n+ parser-aware JSONC deletion`).join('\n'),
    });
  }
  return plans;
}

async function parseForOperation(source: EffectiveEnvironment['sources'][number], fs: FileSystem): Promise<ParsedSource | undefined> {
  try {
    const file = await readTextFile(fs, source.path);
    const parsed = parseContent(file.content, source.parser);
    if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return undefined;
    return { source, value: parsed.value, content: file.content, bytes: file.bytes, newline: file.newline, finalNewline: file.finalNewline };
  } catch {
    return undefined;
  }
}

function sourcePriority(environment: EffectiveEnvironment, server: McpServer): number {
  return environment.sources.find((source) => source.id === server.sourceId)?.priority ?? 0;
}

function reportFindings(report: ScanReport, environment: EffectiveEnvironment) {
  return report.findings.filter((finding) => finding.ruleId === 'MCP001' && finding.doctor === 'mcp' && finding.locations.some((location) => environment.sources.some((source) => source.path === location.path)));
}

function findingIdsForGroup(findings: ScanReport['findings'], group: McpServer[]): string[] {
  const names = new Set(group.map((server) => server.configuredName));
  return findings.filter((finding) => finding.evidence.some((item) => typeof item.summary === 'string' && [...names].some((name) => item.summary.includes(name)))).map((finding) => finding.id);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'server';
}
