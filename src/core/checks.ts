import { deduplicateFindings, internalDiagnosticFinding } from './evidence.js';
import { redactText } from './redaction.js';
import type { CheckDefinition, CheckServices, EffectiveEnvironment, EvidenceClass, Finding, InternalDiagnostic } from './model.js';

export interface CheckRunResult {
  findings: Finding[];
  internalDiagnostics: InternalDiagnostic[];
}

export async function runChecks(environments: EffectiveEnvironment[], checks: CheckDefinition[], services: CheckServices): Promise<CheckRunResult> {
  const findings: Finding[] = [];
  const internalDiagnostics: InternalDiagnostic[] = [];
  const orderedChecks = [...checks].sort((left, right) => left.id.localeCompare(right.id));
  const scanTier = services.scanTier ?? 0;
  for (const environment of environments) {
    for (const check of orderedChecks) {
      if (check.applicableHarnesses && !check.applicableHarnesses.includes(environment.harness)) continue;
      if (check.scanTier !== undefined && scanTier < check.scanTier) continue;
      if (check.requiredEvidence && !check.requiredEvidence.every((evidence) => hasEvidence(environment, evidence))) continue;
      try {
        const result = await check.run(environment, services);
        findings.push(...result);
      } catch (error) {
        const diagnostic: InternalDiagnostic = {
          id: `check:${environment.harness}:${check.id}`,
          phase: 'check',
          message: redactText(error instanceof Error ? error.message : String(error)),
          harness: environment.harness,
          recoverable: true,
        };
        internalDiagnostics.push(diagnostic);
        findings.push(internalDiagnosticFinding(environment, diagnostic));
      }
    }
  }
  return { findings: deduplicateFindings(findings), internalDiagnostics };
}

function hasEvidence(environment: EffectiveEnvironment, evidenceClass: EvidenceClass): boolean {
  if (evidenceClass === 'runtime') {
    return [...environment.mcpServers.map((server) => server.observation), ...environment.hooks.map((hook) => hook.observation)].some((observation) => observation !== undefined && observation.status !== 'not-run' && observation.status !== 'declined' && observation.evidence.length > 0);
  }
  if (evidenceClass === 'behavioral') return Object.keys(environment.unknownFields).some((key) => /(?:benchmark|transcript)/i.test(key));
  if (evidenceClass === 'static' || evidenceClass === 'heuristic') return environment.sources.length > 0 || environment.instructions.length > 0 || environment.mcpServers.length > 0 || environment.hooks.length > 0 || environment.permissions.length > 0 || Object.keys(environment.unknownFields).length > 0;
  return false;
}
