import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../../src/core/scan.js';
import { reportSchema } from '../../src/generated/report-schema.js';
import { formatJson, writeJsonAtomically } from '../../src/reporters/json.js';
import { formatTerminal } from '../../src/reporters/terminal.js';
import { makeFixture } from '../helpers.js';

describe('reporters', () => {
  it('emits schema-valid deterministic JSON and readable terminal output', async () => {
    const fixture = await makeFixture();
    try {
      const report = (await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'] })).report;
      const json = formatJson(report);
      const parsed = JSON.parse(json) as unknown;
      expect(reportSchema.parse(parsed).schemaVersion).toBe(1);
      expect(formatJson(report)).toBe(json);
      const terminal = formatTerminal(report, { color: false });
      expect(terminal).toContain('HARNESS MEDIC');
      expect(terminal).toContain('Coverage');
      expect(terminal).not.toContain('\u001b[');
    } finally {
      await fixture.cleanup();
    }
  });

  it('writes an atomic JSON report without leaving a temporary file', async () => {
    const fixture = await makeFixture();
    const output = path.join(fixture.root, 'out', 'report.json');
    try {
      const report = (await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['cursor'] })).report;
      await writeJsonAtomically(output, report);
      expect(reportSchema.parse(JSON.parse(await fs.readFile(output, 'utf8'))).workspace).toBe(fixture.workspace);
      expect((await fs.readdir(path.dirname(output))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
});
