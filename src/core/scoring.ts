import { sortFindings } from './evidence.js';
import type { Finding, Severity, Summary } from './model.js';

const weightBySeverity: Record<Severity, number> = {
  critical: 25,
  error: 12,
  warning: 4,
  info: 0,
};

export function scoreFindings(findings: Finding[], enabled = true): Summary {
  const bySeverity: Summary['bySeverity'] = { critical: 0, error: 0, warning: 0, info: 0 };
  const byDoctor: Record<string, number> = {};
  let applicable = 0;
  let observed = 0;
  let unscored = 0;
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byDoctor[finding.doctor] = (byDoctor[finding.doctor] ?? 0) + 1;
    if (finding.applicable) applicable += 1;
    if (finding.observed) observed += 1;
    if (!isScoreEligible(finding)) unscored += 1;
  }
  const stableByDoctor = Object.fromEntries(Object.entries(byDoctor).sort(([left], [right]) => left.localeCompare(right)));
  if (!enabled) return { bySeverity, byDoctor: stableByDoctor, applicable, observed, unscored, deductions: [] };
  const eligible = sortFindings(findings.filter(isScoreEligible));
  const grouped = new Map<string, Finding[]>();
  for (const finding of eligible) {
    const key = `${finding.doctor}:${finding.ruleId}`;
    const group = grouped.get(key) ?? [];
    group.push(finding);
    grouped.set(key, group);
  }
  const deductions: Summary['deductions'] = [];
  const doctorTotals: Record<string, number> = {};
  for (const [key, group] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [doctor, ruleId] = key.split(':');
    const first = group[0];
    if (!first || !doctor || !ruleId) continue;
    const base = weightBySeverity[first.severity];
    let ruleTotal = 0;
    for (const [index, finding] of group.entries()) {
      const amount = Math.min(base, finding.scoreImpact > 0 ? finding.scoreImpact : base) * (index === 0 ? 1 : 0.25);
      const bounded = Math.min(amount, base * 2 - ruleTotal);
      if (bounded <= 0) continue;
      ruleTotal += bounded;
      const available = Math.max(0, 40 - (doctorTotals[doctor] ?? 0));
      const applied = Math.min(available, bounded);
      const capped = applied < bounded;
      doctorTotals[doctor] = (doctorTotals[doctor] ?? 0) + applied;
      deductions.push({ ruleId: finding.ruleId, doctor, amount: applied, capped });
    }
  }
  const total = deductions.reduce((sum, deduction) => sum + deduction.amount, 0);
  return { bySeverity, byDoctor: stableByDoctor, applicable, observed, unscored, healthIndex: Math.max(0, Math.round(100 - total)), deductions };
}
function isScoreEligible(finding: Finding): boolean {
  return finding.scoreEligible
    && finding.applicable
    && finding.observed
    && (finding.confidence === 'certain' || finding.confidence === 'high')
    && (finding.evidenceClass !== 'heuristic' || finding.precisionStatus === 'validated');
}

export function severityWeight(severity: Severity): number {
  return weightBySeverity[severity];
}
