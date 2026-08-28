import { describe, expect, it } from 'vitest';
import { containsPotentialSecret, redactText, redactValue } from '../../src/core/redaction.js';
import { buildInstructionDocument, parseInstructionClauses } from '../../src/core/instructions.js';
import { parseContent, parserForPath } from '../../src/parsers/index.js';
import type { ConfigSource } from '../../src/core/model.js';

const source: ConfigSource = {
  id: 'test:instruction', harness: 'claude-code', kind: 'instruction', scope: 'project', path: 'AGENTS.md', priority: 1,
  applicable: true, ownership: 'workspace', parser: 'markdown', parseStatus: 'parsed', diagnostics: [], discoveredBy: 'test',
};

describe('parsers', () => {
  it('distinguishes strict JSON from JSONC', () => {
    expect(parseContent('{"ok": true}', 'json').diagnostics).toHaveLength(0);
    expect(parseContent('{"ok": true,}', 'json').diagnostics.length).toBeGreaterThan(0);
    expect(parseContent('{"ok": true,}', 'jsonc').diagnostics).toHaveLength(0);
    expect(parseContent('{\n // comment\n "ok": true\n}', 'json').diagnostics.length).toBeGreaterThan(0);
  });

  it('dispatches YAML and TOML parsers', () => {
    expect(parserForPath('settings.yaml', 'settings')).toBe('yaml');
    expect(parseContent('enabled: true\n', 'yaml').diagnostics).toHaveLength(0);
    expect(parseContent('enabled = true\n', 'toml').diagnostics).toHaveLength(0);
  });

  it('redacts structural secrets without retaining the value', () => {
    const input = 'apiKey: CANARY_SECRET client_secret=CANARY_CLIENT Bearer abcdefghijklmnop';
    expect(containsPotentialSecret(input)).toBe(true);
    expect(containsPotentialSecret('CANARY_SECRET')).toBe(true);
    const output = redactText(input);
    expect(output).not.toContain('CANARY_SECRET');
    expect(output).not.toContain('CANARY_CLIENT');
    expect(redactValue({ client_secret: 'CANARY_CLIENT', safe: 'ok' })).toEqual({ client_secret: '[REDACTED]', safe: 'ok' });
  });
  it('preserves token estimate objects while redacting sensitive values', () => {
    const estimates = [{ estimator: 'o200k_base', tokens: 12, exact: true }];
    expect(redactValue({ tokenEstimates: estimates, token: 'CANARY_SECRET' })).toEqual({ tokenEstimates: estimates, token: '[REDACTED]' });
  });

  it('extracts directives and ignores fenced examples', () => {
    const content = '# Verification\nAlways run tests.\n```md\nAlways deploy production.\n```\nDo not skip tests when asked.';
    const clauses = parseInstructionClauses(content, 'AGENTS.md');
    expect(clauses.map((clause) => clause.modality)).toEqual(['always', 'must-not']);
    expect(clauses[0]?.scope).toBe('verification');
    const document = buildInstructionDocument(source, `${content}\n`);
    expect(document.bytes).toBe(Buffer.byteLength(`${content}\n`));
    expect(document.finalNewline).toBe(true);
  });
});
