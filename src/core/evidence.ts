import { sha256 } from './fs.js';
import { redactText, redactValue } from './redaction.js';
import { confidenceRank, severityRank, type EffectiveEnvironment, type EvidenceClass, type EvidenceItem, type Finding, type FixSafety, type InternalDiagnostic, type Severity } from './model.js';

export interface FindingInput {
  ruleId: string;
  doctor: Finding['doctor'];
  severity: Severity;
  evidenceClass: EvidenceClass;
  confidence: Finding['confidence'];
  title: string;
  summary: string;
  impact: string;
  evidence: EvidenceItem[];
  locations?: Finding['locations'];
  remediation: string;
  references?: string[];
  applicable?: boolean;
  observed?: boolean;
  scoreEligible?: boolean;
  scoreImpact?: number;
  fixSafety?: FixSafety;
  fixIds?: string[];
  precisionStatus?: Finding['precisionStatus'];
}

export function createFinding(environment: EffectiveEnvironment, input: FindingInput): Finding {
  const evidence = input.evidence.map((item) => redactValue(item) as EvidenceItem);
  const locations = redactValue(input.locations ?? evidence.flatMap((item) => item.location ? [item.location] : [])) as Finding['locations'];
  const identity = `${input.ruleId}|${environment.harness}|${JSON.stringify(evidence)}|${JSON.stringify(locations)}`;
  return {
    id: `finding-${sha256(identity).slice(0, 16)}`,
    ruleId: input.ruleId,
    doctor: input.doctor,
    severity: input.severity,
    evidenceClass: input.evidenceClass,
    confidence: input.confidence,
    title: redactText(input.title),
    summary: redactText(input.summary),
    impact: redactText(input.impact),
    evidence,
    locations,
    remediation: redactText(input.remediation),
    references: [...new Set(input.references ?? [])].sort(),
    applicable: input.applicable ?? true,
    observed: input.observed ?? input.evidence.some((item) => item.evidenceClass !== 'heuristic'),
    scoreEligible: input.scoreEligible ?? false,
    scoreImpact: input.scoreImpact ?? 0,
    fixSafety: input.fixSafety ?? 'manual',
    fixIds: [...new Set(input.fixIds ?? [])].sort(),
    ...(input.precisionStatus ? { precisionStatus: input.precisionStatus } : {}),
  };
}

export function internalDiagnosticFinding(environment: EffectiveEnvironment, diagnostic: InternalDiagnostic): Finding {
  return createFinding(environment, {
    ruleId: 'INTERNAL001',
    doctor: 'internal',
    severity: 'error',
    evidenceClass: 'static',
    confidence: 'certain',
    title: 'Internal diagnostic',
    summary: diagnostic.message,
    impact: 'One part of the scan failed; other environments and checks remain available.',
    evidence: [{ id: diagnostic.id, kind: 'configuration', summary: diagnostic.message, ...(diagnostic.sourceId ? { sourceId: diagnostic.sourceId } : {}), evidenceClass: 'static' }],
    remediation: 'Inspect the named source or rerun with --verbose for local diagnostics.',
    applicable: true,
    observed: true,
    scoreEligible: false,
    fixSafety: 'manual',
  });
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || confidenceRank[left.confidence] - confidenceRank[right.confidence]
    || left.doctor.localeCompare(right.doctor)
    || left.ruleId.localeCompare(right.ruleId)
    || (left.locations[0]?.path ?? '').localeCompare(right.locations[0]?.path ?? '')
    || left.id.localeCompare(right.id));
}

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of sortFindings(findings)) {
    const identity = `${finding.ruleId}|${finding.doctor}|${JSON.stringify(finding.evidence.map((item) => ({ sourceId: item.sourceId, location: item.location, value: item.value, summary: item.summary })))}`;
    if (!seen.has(identity)) seen.set(identity, finding);
  }
  return sortFindings([...seen.values()]);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value), null, 2);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) output[key] = sortObject((value as Record<string, unknown>)[key]);
    return output;
  }
  return value;
}
