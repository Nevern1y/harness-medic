import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
const npmArguments = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json'] : ['pack', '--dry-run', '--json'];
const required = ['package.json', 'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'LICENSE', 'NOTICE', 'assets/brand/harness-medic-social-preview.png', 'assets/demo/harness-medic-scan.png', 'assets/demo/harness-medic-flow.svg', 'docs/compatibility.md', 'docs/privacy.md', 'docs/threat-model.md', 'docs/contributing-fixtures.md', 'docs/publishing.md', 'docs/rule-reference/index.md', 'examples/reports/minimal.json', 'dist/cli/index.mjs', 'dist/index.mjs', 'schemas/report-v1.schema.json'];
const forbidden = /^(?:src|tests|scripts|docs\/plans|node_modules|\.github)\//;

for (const file of required) {
  try {
    await fs.access(path.join(root, file));
  } catch {
    throw new Error(`Required package input is missing: ${file}`);
  }
}
const { stdout } = await execFileAsync(npm, npmArguments, { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const payload = JSON.parse(stdout) as Array<{ files?: Array<{ path?: string }> }>;
const files = (payload[0]?.files ?? []).map((entry) => entry.path ?? '').filter(Boolean).sort();
for (const file of required) if (!files.includes(file)) throw new Error(`Packed tarball is missing ${file}`);
const leaks = files.filter((file) => forbidden.test(file) || /(?:\.env(?:\.|$)|\.tmp$|\.log$|package-lock\.json$)/i.test(file));
if (leaks.length > 0) throw new Error(`Packed tarball contains forbidden files: ${leaks.join(', ')}`);
process.stdout.write(`${JSON.stringify({ files: files.length, required: required.length, forbidden: leaks.length, package: path.basename(payload[0] ? 'package.tgz' : 'unknown') })}\n`);
