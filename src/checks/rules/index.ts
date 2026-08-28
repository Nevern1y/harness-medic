import { resolvePathFrom } from '../../core/fs.js';
import { createFinding } from '../../core/evidence.js';
import { clausePolarityKey } from '../../core/instructions.js';
import type { CheckDefinition, EffectiveEnvironment, Finding, InstructionClause } from '../../core/model.js';

const references = ['https://developers.openai.com/codex/guides/agents-md', 'https://opencode.ai/docs/rules/', 'https://cursor.com/docs/context/rules'];

export const rulesChecks: CheckDefinition[] = [
  {
    id: 'RULE001', doctor: 'rules', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const findings: Finding[] = [];
      for (const source of environment.sources) {
        if (source.parseStatus !== 'invalid') continue;
        findings.push(createFinding(environment, {
          ruleId: 'RULE001', doctor: 'rules', severity: 'error', evidenceClass: 'static', confidence: 'certain',
          title: 'Invalid instruction or configuration source',
          summary: `${source.path} could not be parsed or read.`,
          impact: 'The source cannot contribute reliably to the effective environment.',
          evidence: source.diagnostics.map((diagnostic) => ({ id: `${source.id}:${diagnostic.code}`, kind: 'configuration' as const, summary: diagnostic.message, sourceId: source.id, location: diagnostic.location, evidenceClass: 'static' as const })),
          locations: [{ path: source.path }],
          remediation: 'Fix the source syntax or permissions, then rerun the scan.',
          references,
          observed: true,
          scoreEligible: true,
          scoreImpact: 12,
        }));
      }
      return findings;
    },
  },
  {
    id: 'RULE002', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const shadowed = new Set(environment.shadowEdges.map((edge) => edge.fromSourceId));
      const mcpSources = new Set(environment.mcpServers.map((server) => server.sourceId));
      return environment.instructions.filter((document) => (!mcpSources.has(document.sourceId) && shadowed.has(document.sourceId)) || !document.active).map((document) => createFinding(environment, {
        ruleId: 'RULE002', doctor: 'rules', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Shadowed instruction file',
        summary: `${document.path} was discovered but does not apply in the effective environment.`,
        impact: 'Editing this file alone will not change the loaded instructions.',
        evidence: [{ id: document.id, kind: 'comparison', summary: 'source loses documented precedence', sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' }],
        remediation: 'Edit the active higher-precedence source or remove the stale copy after review.',
        references,
        locations: [document.sourceSpan],
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
        fixSafety: 'review',
      }));
    },
  },
  {
    id: 'RULE003', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    async run(environment, services) {
      if (!services.fs) return [];
      const findings: Finding[] = [];
      for (const document of environment.instructions.filter((entry) => entry.active)) {
        for (const match of stripFenced(document.content).matchAll(/(?:^|[\s("'`])((?:\.\.?[\\/]|~[\\/]|[A-Za-z]:[\\/]|\\\\|\/)[^\s`"'<>]+|(?:[\w.-]+[\\/])[\w./\\~+:-]+)/g)) {
          const value = match[1]?.trim().replace(/[),.;:!?]+$/g, '');
          if (!value || /^https?:\/\//i.test(value)) continue;
          const isWindows = services.platform === 'win32' || (services.platform === undefined && /^[A-Za-z]:[\\/]/.test(environment.workspace));
          const target = resolvePathFrom(environment.workspace, value, isWindows);
          if (await services.fs.access(target)) continue;
          findings.push(createFinding(environment, {
            ruleId: 'RULE003', doctor: 'rules', severity: 'warning', evidenceClass: 'static', confidence: 'high',
            title: 'Stale path reference',
            summary: `${document.path} references ${value}, which does not exist from the workspace path.`,
            impact: 'The documented path may be stale when the instruction is followed.',
            evidence: [{ id: `${document.id}:${value}`, kind: 'span', summary: value, value, sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' }],
            remediation: 'Confirm the path from the harness-defined working directory or update the instruction.',
            references,
            locations: [document.sourceSpan],
            observed: true,
            scoreEligible: false,
          }));
        }
      }
      return findings;
    },
  },
  {
    id: 'RULE004', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    async run(environment, services) {
      const findings: Finding[] = [];
      const commandPattern = /`([A-Za-z][\w.-]*(?:\.[A-Za-z0-9_-]+)?)(?:\s+[^`]+)?`/g;
      for (const document of environment.instructions.filter((entry) => entry.active)) {
        for (const match of document.content.matchAll(commandPattern)) {
          const command = match[1];
          if (!command || ['http', 'https', 'json', 'yaml', 'toml'].includes(command.toLowerCase())) continue;
          const resolved = await services.resolveExecutable(command, environment.workspace);
          if (resolved) continue;
          findings.push(createFinding(environment, {
            ruleId: 'RULE004', doctor: 'rules', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
            title: 'Command reference did not resolve',
            summary: `${document.path} references ${command}, which was not resolved from the workspace path.`,
            impact: 'The documented command may be unavailable when the instruction is followed.',
            evidence: [{ id: `${document.id}:${command}`, kind: 'configuration', summary: command, value: command, sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' }],
            remediation: 'Install the command, use the package script that exists, or correct the instruction.',
            references,
            locations: [document.sourceSpan],
            observed: true,
            scoreEligible: false,
          }));
        }
      }
      return findings;
    },
  },
  {
    id: 'RULE005', doctor: 'rules', defaultSeverity: 'error', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      const clauses = environment.instructions.filter((document) => document.active).flatMap((document) => document.clauses.map((clause) => ({ document, clause })));
      const findings: Finding[] = [];
      for (let leftIndex = 0; leftIndex < clauses.length; leftIndex += 1) {
        const left = clauses[leftIndex];
        if (!left) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < clauses.length; rightIndex += 1) {
          const right = clauses[rightIndex];
          if (!right || clausePolarityKey(left.clause) !== clausePolarityKey(right.clause) || !scopesOverlap(left.clause, right.clause)) continue;
          if (!oppositeDirective(left.clause.modality, right.clause.modality)) continue;
          findings.push(createFinding(environment, {
            ruleId: 'RULE005', doctor: 'rules', severity: 'error', evidenceClass: 'heuristic', confidence: 'high',
            title: 'Contradictory active directives',
            summary: `${left.document.path} and ${right.document.path} express opposite polarity for ${left.clause.action} ${left.clause.object}.`,
            impact: 'The effective precedence may cause one directive to win; the static scan cannot claim a runtime violation.',
            evidence: [
              { id: left.clause.id, kind: 'span', summary: left.clause.normalized, sourceId: left.document.sourceId, location: left.clause.sourceSpan, evidenceClass: 'heuristic' },
              { id: right.clause.id, kind: 'span', summary: right.clause.normalized, sourceId: right.document.sourceId, location: right.clause.sourceSpan, evidenceClass: 'heuristic' },
            ],
            locations: [left.clause.sourceSpan, right.clause.sourceSpan],
            remediation: 'Resolve the conflict in the higher-precedence source and verify the harness-specific load order.',
            references,
            observed: true,
            scoreEligible: false,
            precisionStatus: 'unmeasured',
          }));
        }
      }
      return findings;
    },
  },
  {
    id: 'RULE006', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const groups = new Map<string, Array<{ document: EffectiveEnvironment['instructions'][number]; clause: InstructionClause }>>();
      for (const document of environment.instructions.filter((entry) => entry.active)) {
        for (const clause of document.clauses) {
          const group = groups.get(clause.normalized) ?? [];
          group.push({ document, clause });
          groups.set(clause.normalized, group);
        }
      }
      const findings: Finding[] = [];
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const first = group[0];
        if (!first) continue;
        findings.push(createFinding(environment, {
          ruleId: 'RULE006', doctor: 'rules', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
          title: 'Duplicate active directive',
          summary: `${group.length} active instruction clauses normalize to the same directive.`,
          impact: 'Repeated directives consume observed context and can make future maintenance inconsistent.',
          evidence: group.map((entry) => ({ id: entry.clause.id, kind: 'comparison' as const, summary: entry.document.path, sourceId: entry.document.sourceId, location: entry.clause.sourceSpan, evidenceClass: 'static' as const })),
          remediation: 'Keep one authoritative directive or narrow the scopes so each instruction has a distinct purpose.',
          references,
          observed: true,
          scoreEligible: true,
          scoreImpact: 4,
        }));
      }
      return findings;
    },
  },
  {
    id: 'RULE007', doctor: 'rules', defaultSeverity: 'info', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      return environment.instructions.filter((document) => document.active && /\b(be good|be careful|use common sense|act appropriately)\b/i.test(document.content)).map((document) => createFinding(environment, {
        ruleId: 'RULE007', doctor: 'rules', severity: 'info', evidenceClass: 'heuristic', confidence: 'low',
        title: 'Vague or unverifiable directive',
        summary: `${document.path} contains a broad directive whose operational meaning is not statically verifiable.`,
        impact: 'The instruction may be useful context but cannot be checked deterministically.',
        evidence: [{ id: `${document.id}:vague`, kind: 'span', summary: 'broad directive matched', sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'heuristic' }],
        remediation: 'Replace broad wording with a concrete action, object, and observable condition when practical.',
        references,
        observed: true,
        scoreEligible: false,
        precisionStatus: 'unmeasured',
      }));
    },
  },
  {
    id: 'RULE008', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      return environment.instructions.filter((document) => document.active && (document.bytes > 32768 || (document.tokenEstimates[0]?.tokens ?? 0) > 8000)).map((document) => createFinding(environment, {
        ruleId: 'RULE008', doctor: 'rules', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Oversize observed instruction source',
        summary: `${document.path} contains ${document.bytes} bytes and approximately ${document.tokenEstimates[0]?.tokens ?? 0} tokens.`,
        impact: 'Large observed sources consume context budget; size alone does not prove model failure or unused content.',
        evidence: [{ id: document.id, kind: 'metric', summary: `${document.bytes} bytes`, value: document.bytes, sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' }],
        remediation: 'Split or shorten the source only after reviewing the harness precedence and required scope.',
        references,
        observed: true,
        scoreEligible: false,
      }));
    },
  },
  {
    id: 'RULE009', doctor: 'rules', defaultSeverity: 'warning', evidenceClass: 'behavioral', scoreEligible: false, references, scanTier: 2, requiredEvidence: ['behavioral'],
    run(environment) {
      const candidate = environment.unknownFields['benchmark.adherence'] ?? environment.unknownFields['benchmark:adherence'];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const metric = candidate as Record<string, unknown>;
      const rate = typeof metric.rate === 'number' ? metric.rate : undefined;
      const samples = typeof metric.samples === 'number' ? metric.samples : undefined;
      const previousRate = typeof metric.previousRate === 'number' ? metric.previousRate : undefined;
      if (rate === undefined || samples === undefined || samples <= 0 || rate >= (previousRate ?? rate)) return [];
      return [createFinding(environment, {
        ruleId: 'RULE009', doctor: 'rules', severity: 'warning', evidenceClass: 'behavioral', confidence: 'high',
        title: 'Observed rule-adherence regression',
        summary: `Observed adherence decreased from ${((previousRate ?? rate) * 100).toFixed(1)}% to ${(rate * 100).toFixed(1)}% across ${Math.floor(samples)} recorded trial(s).`,
        impact: 'The benchmark window shows a regression, but stochastic observations do not guarantee future behavior.',
        evidence: [{ id: `${environment.harness}:benchmark-adherence`, kind: 'metric', summary: `${rate}/${samples}`, value: rate, evidenceClass: 'behavioral' }],
        remediation: 'Inspect the recorded benchmark window, harness mode, and changed instructions before treating this as a release signal.',
        references,
        observed: true,
        scoreEligible: false,
      })];
    },
  },
];

function scopesOverlap(left: InstructionClause, right: InstructionClause): boolean {
  if (left.scope === undefined || right.scope === undefined) return true;
  if (left.scope === right.scope) return true;
  if (left.condition === undefined || right.condition === undefined) return false;
  return left.condition === right.condition;
}

function oppositeDirective(left: InstructionClause['modality'], right: InstructionClause['modality']): boolean {
  const polarity = (modality: InstructionClause['modality']): 'positive' | 'negative' | undefined => {
    if (modality === 'must' || modality === 'always' || modality === 'directive' || modality === 'should') return 'positive';
    if (modality === 'must-not' || modality === 'never' || modality === 'should-not') return 'negative';
    return undefined;
  };
  const leftPolarity = polarity(left);
  const rightPolarity = polarity(right);
  return leftPolarity !== undefined && rightPolarity !== undefined && leftPolarity !== rightPolarity;
}

function stripFenced(content: string): string {
  const lines = content.split(/\r?\n/);
  let fenced = false;
  return lines.filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  }).join('\n');
}
