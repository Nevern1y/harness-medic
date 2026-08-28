import { describe, expect, it } from 'vitest';
import { createFinding, deduplicateFindings, stableJson } from '../../src/core/evidence.js';
import { scoreFindings } from '../../src/core/scoring.js';
import { emptyEnvironment } from '../helpers.js';

describe('evidence and scoring', () => {
  it('creates redacted stable findings and deduplicates equivalent evidence', () => {
    const environment = emptyEnvironment();
    const input = {
      ruleId: 'TEST001', doctor: 'security' as const, severity: 'warning' as const, evidenceClass: 'heuristic' as const, confidence: 'medium' as const,
      title: 'Secret token', summary: 'token=CANARY_SECRET', impact: 'review',
      evidence: [{ id: 'e1', kind: 'span' as const, summary: 'apiKey=CANARY_SECRET', value: 'apiKey=CANARY_SECRET', evidenceClass: 'heuristic' as const }],
      remediation: 'review', precisionStatus: 'unmeasured' as const,
    };
    const first = createFinding(environment, input);
    const second = createFinding(environment, input);
    expect(first.id).toBe(second.id);
    expect(JSON.stringify(first)).not.toContain('CANARY_SECRET');
    expect(deduplicateFindings([second, first])).toHaveLength(1);
  });

  it('does not score unmeasured heuristic findings', () => {
    const environment = emptyEnvironment();
    const finding = createFinding(environment, {
      ruleId: 'TEST002', doctor: 'rules', severity: 'error', evidenceClass: 'heuristic', confidence: 'high', title: 'Conflict', summary: 'conflict', impact: 'impact',
      evidence: [{ id: 'e2', kind: 'span', summary: 'conflict', evidenceClass: 'heuristic' }], remediation: 'review', scoreEligible: true, scoreImpact: 12,
      precisionStatus: 'unmeasured', observed: true,
    });
    const summary = scoreFindings([finding]);
    expect(summary.healthIndex).toBe(100);
    expect(summary.unscored).toBe(1);
    expect(summary.deductions).toHaveLength(0);
  });

  it('sorts object keys deterministically', () => {
    expect(stableJson({ z: 1, a: { d: 2, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "z": 1\n}');
  });
});
