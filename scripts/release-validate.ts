import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportSchema } from '../src/generated/report-schema.js';
import { formatJson } from '../src/reporters/json.js';
import { createBaselineSnapshot } from '../src/baseline/index.js';
import { ruleIds } from '../src/checks/index.js';
import { adapters } from '../src/adapters/index.js';
import type { ScanReport } from '../src/core/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { name?: string; version?: string; engines?: { node?: string }; files?: string[]; bin?: Record<string, string>; dependencies?: Record<string, string> };
if (packageJson.name !== 'harness-medic') throw new Error('Package name must remain harness-medic');
if (!packageJson.version || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) throw new Error('Package version must be semver');
if (packageJson.engines?.node !== '>=24') throw new Error('Node engine floor must remain >=24');
for (const file of ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'LICENSE', 'NOTICE', 'assets/brand/harness-medic-social-preview.png', 'assets/demo/harness-medic-scan.png', 'assets/demo/harness-medic-flow.svg', 'schemas/report-v1.schema.json', 'docs/compatibility.md', 'docs/privacy.md', 'docs/threat-model.md', 'docs/contributing-fixtures.md', 'docs/publishing.md', 'docs/rule-reference/index.md', 'examples/reports/minimal.json']) {
  await fs.access(path.join(root, file));
}
const schemaText = await fs.readFile(path.join(root, 'schemas', 'report-v1.schema.json'), 'utf8');
const schema = JSON.parse(schemaText) as { $id?: string; properties?: Record<string, unknown> };
if (schema.$id !== 'https://harness-medic.dev/schemas/report-v1.schema.json' || !schema.properties?.schemaVersion) throw new Error('Report schema metadata is incomplete');
const requiredFiles = packageJson.files ?? [];
if (!requiredFiles.includes('dist')) throw new Error('Package files must include dist');
const bin = packageJson.bin?.['harness-medic'];
if (bin !== 'dist/cli/index.mjs') throw new Error('CLI bin path is incorrect');
const sourceFiles = await collect(path.join(root, 'src'));
const placeholder = sourceFiles.find((file) => /\b(?:TODO|FIXME|TBD)\b/.test(file.content));
if (placeholder) throw new Error(`Placeholder marker found in source: ${placeholder.path}`);
const ruleReference = await fs.readFile(path.join(root, 'docs', 'rule-reference', 'index.md'), 'utf8');
const documentedRuleIds = [...ruleReference.matchAll(/^\| ((?:CTX|RULE|MCP|HOOK|SEC)\d+) \|/gm)].map((match) => match[1]).filter((value): value is string => Boolean(value)).sort();
const registeredRuleIds = [...ruleIds].sort();
if (JSON.stringify(documentedRuleIds) !== JSON.stringify(registeredRuleIds)) throw new Error('Rule reference does not match the live rule registry');
const compatibility = await fs.readFile(path.join(root, 'docs', 'compatibility.md'), 'utf8');
const compatibilityRows = [...compatibility.matchAll(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/gm)].map((match) => ({ harness: match[1]!, contract: match[2]! }));
const labels: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', cursor: 'Cursor' };
const expectedCompatibility = adapters.map((adapter) => ({ harness: labels[adapter.id], contract: adapter.version }));
if (JSON.stringify(compatibilityRows) !== JSON.stringify(expectedCompatibility)) throw new Error('Compatibility matrix is out of sync with adapter metadata');
for (const link of [...ruleReference.matchAll(/https?:\/\/[^)\s`]+/g)].map((match) => match[0])) new URL(link);
const lockfile = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { license?: string; name?: string; version?: string }> };
const missingLicenses = Object.keys(packageJson.dependencies ?? {}).filter((name) => typeof lockfile.packages?.[`node_modules/${name}`]?.license !== 'string');
if (missingLicenses.length > 0) throw new Error(`Direct dependencies missing lockfile license metadata: ${missingLicenses.join(', ')}`);
const lockRoot = lockfile.packages?.[''];
if (lockRoot?.name !== packageJson.name || lockRoot?.version !== packageJson.version) throw new Error('package-lock root metadata does not match package.json');
const example = JSON.parse(await fs.readFile(path.join(root, 'examples', 'reports', 'minimal.json'), 'utf8')) as ScanReport;
reportSchema.parse(example);
const formatted = formatJson(example);
reportSchema.parse(JSON.parse(formatted));
const baseline = createBaselineSnapshot(example, '1970-01-01T00:00:00.000Z');
if (baseline.schemaVersion !== 1 || baseline.workspace !== example.workspace) throw new Error('Baseline compatibility check failed');
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, package: packageJson.name, version: packageJson.version, example: 'valid', baseline: 'valid', rules: registeredRuleIds.length, sourceFiles: sourceFiles.length })}\n`);

async function collect(directory: string): Promise<Array<{ path: string; content: string }>> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(target));
    else files.push({ path: path.relative(root, target), content: await fs.readFile(target, 'utf8') });
  }
  return files;
}
