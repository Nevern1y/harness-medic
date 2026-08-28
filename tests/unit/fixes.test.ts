import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServices, NodeFileSystem, sha256, readTextFile } from '../../src/core/fs.js';
import { parseContent } from '../../src/parsers/index.js';
import { buildJsonDeleteOperation } from '../../src/fixes/operations/jsonc.js';
import { applyFixPlan } from '../../src/fixes/transaction.js';
import type { ConfigSource, FixPlan } from '../../src/core/model.js';

async function makePlan(filePath: string, content: string): Promise<FixPlan> {
  const file = await readTextFile(new NodeFileSystem(), filePath);
  const source: ConfigSource = {
    id: 'fixture:source', harness: 'claude-code', kind: 'mcp', scope: 'project', path: filePath, priority: 1, applicable: true, ownership: 'workspace',
    parser: 'jsonc', parseStatus: 'parsed', diagnostics: [], discoveredBy: 'test',
  };
  const parsed = parseContent(content, 'jsonc');
  const operation = buildJsonDeleteOperation({ source, parsed: { source, value: parsed.value, content: file.content, bytes: file.bytes, newline: file.newline, finalNewline: file.finalNewline }, path: ['mcpServers', 'duplicate'], label: 'duplicate registration' });
  return { id: 'fix-test', findingIds: [], safety: 'safe', operations: [operation], preconditions: [{ path: filePath, contentHash: sha256(content) }], postconditions: [], affectedPaths: [filePath], preview: 'preview' };
}

describe('transactional fixes', () => {
  it('preserves JSONC comments and commits parser-aware deletion', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'tests', '.tmp-fix-'));
    const filePath = path.join(root, 'config.jsonc');
    const content = '{\r\n  // keep this comment\r\n  "mcpServers": {\r\n    "winner": { "command": "node" },\r\n    "duplicate": { "command": "node" }\r\n  }\r\n}\r\n';
    await fs.writeFile(filePath, content, 'utf8');
    try {
      const plan = await makePlan(filePath, content);
      const result = await applyFixPlan(plan, createServices(new NodeFileSystem()), { dryRun: false });
      expect(result.status).toBe('committed');
      const output = await fs.readFile(filePath, 'utf8');
      expect(output).toContain('// keep this comment');
      expect(output).not.toContain('duplicate');
      expect(output).toMatch(/\r\n/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('aborts changed-on-disk input before writing', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'tests', '.tmp-fix-'));
    const filePath = path.join(root, 'config.jsonc');
    const original = '{"mcpServers":{"duplicate":{"command":"node"}}}\n';
    await fs.writeFile(filePath, original, 'utf8');
    try {
      const plan = await makePlan(filePath, original);
      await fs.writeFile(filePath, '{"changed":true}\n', 'utf8');
      const result = await applyFixPlan(plan, createServices(new NodeFileSystem()), { dryRun: false });
      expect(result.status).toBe('aborted');
      expect(await fs.readFile(filePath, 'utf8')).toBe('{"changed":true}\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('rolls back every touched file after a mid-transaction failure', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'tests', '.tmp-fix-'));
    const firstPath = path.join(root, 'first.jsonc');
    const secondPath = path.join(root, 'second.jsonc');
    const first = '{"mcpServers":{"duplicate":{"command":"node"}}}\n';
    const second = '{"mcpServers":{"duplicate":{"command":"deno"}}}\n';
    await fs.writeFile(firstPath, first, 'utf8');
    await fs.writeFile(secondPath, second, 'utf8');
    try {
      const firstPlan = await makePlan(firstPath, first);
      const secondPlan = await makePlan(secondPath, second);
      const plan = { ...firstPlan, id: 'rollback-test', operations: [...firstPlan.operations, ...secondPlan.operations], preconditions: [...firstPlan.preconditions, ...secondPlan.preconditions], affectedPaths: [firstPath, secondPath] };
      const result = await applyFixPlan(plan, createServices(new NodeFileSystem()), { dryRun: false, failAfterOperation: 2 });
      expect(result.status).toBe('rolled-back');
      expect(await fs.readFile(firstPath, 'utf8')).toBe(first);
      expect(await fs.readFile(secondPath, 'utf8')).toBe(second);
      expect(result.restoredPaths).toEqual(expect.arrayContaining([firstPath, secondPath]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
