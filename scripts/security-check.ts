import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityChecks } from '../src/checks/security/index.js';
import type { CheckServices, EffectiveEnvironment, ToolMetadata } from '../src/core/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'tests', 'fixtures', 'security-corpus');
const services: CheckServices = {
  resolveExecutable: async () => undefined,
  now: () => new Date(0),
  envNames: [],
  platform: process.platform,
};

function environmentFromFixture(value: unknown, filePath: string): EffectiveEnvironment {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const toolRecord = record.tool && typeof record.tool === 'object' && !Array.isArray(record.tool) ? record.tool as Record<string, unknown> : {};
  const tool: ToolMetadata = {
    name: typeof toolRecord.name === 'string' ? toolRecord.name : 'fixture-tool',
    ...(typeof toolRecord.description === 'string' ? { description: toolRecord.description } : {}),
    ...(toolRecord.inputSchema !== undefined ? { inputSchema: toolRecord.inputSchema } : {}),
  };
  return {
    harness: 'claude-code', adapterVersion: 'corpus/1', workspace: root, detected: true,
    sources: [], activeSourceIds: [], shadowEdges: [], coverageGaps: [], instructions: [], tools: [], hooks: [], subagents: [], permissions: [], unknownFields: {},
    mcpServers: [{
      id: `corpus:${path.basename(filePath)}`, sourceId: 'corpus:source', configuredName: 'corpus-server', canonicalIdentity: 'stdio|corpus', transport: 'stdio',
      envKeyNames: [], enabled: true, active: true, trust: 'third-party', toolInventory: { observed: false, tools: [tool] },
    }],
  };
}

async function corpusFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await corpusFiles(target));
    else if (entry.name.endsWith('.json')) files.push(target);
  }
  return files.sort();
}

const corpusFilesList = await corpusFiles(corpus);
const cases = await Promise.all(corpusFilesList.map(async (filePath) => {
  const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  const findings = (await Promise.all(securityChecks.map((check) => check.run(environmentFromFixture(value, filePath), services)))).flat();
  const relative = path.relative(corpus, filePath).replaceAll(path.sep, '/');
  const positive = relative.startsWith('positive/') || path.basename(filePath).startsWith('suspicious');
  return { relative, positive, findings };
}));
const negativeCases = cases.filter((entry) => !entry.positive);
const positiveCases = cases.filter((entry) => entry.positive);
const negativeFindings = negativeCases.flatMap((entry) => entry.findings);
const suspiciousFindings = positiveCases.flatMap((entry) => entry.findings);
if (positiveCases.length === 0 || negativeCases.length === 0) throw new Error('Security corpus needs positive and negative cases');
if (negativeFindings.some((finding) => finding.ruleId === 'SEC001')) throw new Error('Security corpus negative case matched SEC001');
if (positiveCases.some((entry) => !entry.findings.some((finding) => finding.ruleId === 'SEC001'))) throw new Error('Security corpus positive case did not match SEC001');
if (JSON.stringify([...negativeFindings, ...suspiciousFindings]).includes('CANARY_SECRET')) throw new Error('Security corpus leaked a secret canary');

const report = {
  schemaVersion: 1,
  negative: { cases: negativeCases.length, findings: negativeFindings.length, sec001: negativeFindings.filter((finding) => finding.ruleId === 'SEC001').length },
  suspicious: { cases: positiveCases.length, findings: suspiciousFindings.length, sec001: suspiciousFindings.filter((finding) => finding.ruleId === 'SEC001').length },
  rules: securityChecks.map((check) => ({ id: check.id, evidenceClass: check.evidenceClass, scoreEligible: check.scoreEligible })).sort((left, right) => left.id.localeCompare(right.id)),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
