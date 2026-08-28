import { describe, expect, it } from 'vitest';
import { scanWorkspace } from '../../src/core/scan.js';
import { formatJson } from '../../src/reporters/json.js';
import { makeFixture } from '../helpers.js';

describe('process and privacy smoke', () => {
  it('runs a default scan without configured process or network side effects', async () => {
    const fixture = await makeFixture({ 'workspace/.claude/settings.json': '{"model":"fixture"}\n' });
    try {
      const report = (await scanWorkspace({ cwd: fixture.workspace, home: fixture.home, selectedHarnesses: ['claude-code'], envNames: [] })).report;
      expect(report.privacy.childProcesses).toBe(0);
      expect(report.privacy.networkRequests).toBe(0);
      expect(report.privacy.valuesSerialized).toBe(false);
      expect(JSON.parse(formatJson(report)).privacy.childProcesses).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
