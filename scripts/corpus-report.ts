import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests', 'fixtures');

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await filesUnder(target));
    else paths.push(path.relative(fixtures, target).replaceAll(path.sep, '/'));
  }
  return paths.sort();
}

const files = await filesUnder(fixtures);
const groups = new Map<string, number>();
for (const file of files) {
  const group = file.split('/')[0] ?? 'root';
  groups.set(group, (groups.get(group) ?? 0) + 1);
}
const report = {
  schemaVersion: 1,
  fixtureFiles: files.length,
  groups: Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))),
  security: {
    positive: files.filter((file) => file.startsWith('security-corpus/') && file.includes('/positive/')).length,
    negative: files.filter((file) => file.startsWith('security-corpus/') && file.includes('/negative/')).length,
  },
  requiredCategories: ['claude-code', 'codex', 'opencode', 'cursor', 'cross-harness', 'security-corpus', 'mcp-servers', 'transcripts', 'benchmark-results'],
};
for (const category of report.requiredCategories) if (!groups.has(category)) throw new Error(`Fixture category is missing: ${category}`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
