import { describe, expect, it } from 'vitest';
import { rulesChecks } from '../../src/checks/rules/index.js';
import { NodeFileSystem } from '../../src/core/fs.js';
import { emptyEnvironment } from '../helpers.js';
import type { CheckServices, InstructionClause, InstructionDocument } from '../../src/core/model.js';

const services: CheckServices = {
  resolveExecutable: async () => undefined,
  now: () => new Date(0),
  envNames: [],
  platform: 'win32',
  fs: new NodeFileSystem(),
};

function document(id: string, content: string, clauses: InstructionClause[] = []): InstructionDocument {
  return {
    id,
    sourceId: `${id}:source`,
    path: `C:/workspace/${id}.md`,
    scope: 'project',
    loadMode: 'automatic',
    active: true,
    bytes: Buffer.byteLength(content),
    tokenEstimates: [],
    imports: [],
    clauses,
    sourceSpan: { path: `C:/workspace/${id}.md`, line: 1, column: 0 },
    textHash: id,
    content,
    newline: 'lf',
    finalNewline: content.endsWith('\n'),
  };
}

function clause(id: string, modality: InstructionClause['modality'], condition?: string): InstructionClause {
  return {
    id,
    modality,
    action: 'run',
    object: 'tests',
    ...(condition ? { condition, scope: condition } : {}),
    normalized: `${modality}:run:tests:${condition ?? ''}`,
    sourceSpan: { path: `C:/workspace/${id}.md`, line: 1, column: 0 },
  };
}

describe('rules doctor', () => {
  it('does not treat commands or fenced examples as stale paths', async () => {
    const environment = emptyEnvironment('claude-code', 'C:/workspace');
    environment.instructions = [document('commands', 'Run npm test.\n```md\nRead ./missing-example.md\n```\n')];
    const check = rulesChecks.find((entry) => entry.id === 'RULE003');
    expect(check).toBeDefined();
    expect(await check!.run(environment, services)).toEqual([]);
  });

  it('resolves concrete POSIX paths against a Windows workspace', async () => {
    const environment = emptyEnvironment('claude-code', 'C:/workspace');
    environment.instructions = [document('path', 'Read /missing/fixture.md before continuing.\n')];
    const check = rulesChecks.find((entry) => entry.id === 'RULE003');
    expect(check).toBeDefined();
    await expect(check!.run(environment, services)).resolves.toHaveLength(1);
  });

  it('requires overlapping scopes before reporting opposite directives', async () => {
    const environment = emptyEnvironment();
    environment.instructions = [
      document('first', 'Always run tests.', [clause('first-clause', 'must', 'verification')]),
      document('second', 'Never run tests.', [clause('second-clause', 'must-not', 'deployment')]),
      document('third', 'Never run tests.', [clause('third-clause', 'must-not', 'verification')]),
    ];
    const check = rulesChecks.find((entry) => entry.id === 'RULE005');
    expect(check).toBeDefined();
    const findings = await check!.run(environment, services);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.map((entry) => entry.id)).toEqual(['first-clause', 'third-clause']);
  });
});
