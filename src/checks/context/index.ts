import { createFinding } from '../../core/evidence.js';
import { estimateTokenSet } from '../../core/tokens.js';
import type { CheckDefinition, Finding } from '../../core/model.js';

const references = ['https://modelcontextprotocol.io/specification/2025-11-25/server/tools'];

export const contextChecks: CheckDefinition[] = [
  {
    id: 'CTX001', doctor: 'context', defaultSeverity: 'info', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      const active = environment.instructions.filter((document) => document.active);
      const totalBytes = active.reduce((sum, document) => sum + document.bytes, 0);
      const totalTokens = active.reduce((sum, document) => sum + (document.tokenEstimates[0]?.tokens ?? 0), 0);
      if (active.length === 0) return [];
      return [createFinding(environment, {
        ruleId: 'CTX001', doctor: 'context', severity: 'info', evidenceClass: 'static', confidence: 'certain',
        title: 'Observed instruction budget',
        summary: `${active.length} active instruction source(s) contain ${totalBytes} observed bytes and approximately ${totalTokens} tokens.`,
        impact: 'This is an observed component only; system, plugin, and runtime context may be larger.',
        evidence: active.map((document) => ({ id: document.id, kind: 'metric' as const, summary: `${document.path}: ${document.bytes} bytes`, value: document.tokenEstimates[0]?.tokens ?? 0, sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' as const })),
        remediation: 'Review the largest observed sources if prompt overhead is a concern; no unused-context claim is made in static mode.',
        references,
        observed: true,
        scoreEligible: false,
      })];
    },
  },
  {
    id: 'CTX002', doctor: 'context', defaultSeverity: 'info', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      const inventories = environment.mcpServers.filter((server) => server.active && server.toolInventory);
      if (inventories.length === 0) return [];
      return inventories.map((server) => {
        const tools = server.toolInventory?.tools ?? [];
        const serialized = JSON.stringify(tools);
        const estimate = estimateTokenSet(serialized);
        return createFinding(environment, {
          ruleId: 'CTX002', doctor: 'context', severity: 'info', evidenceClass: 'static', confidence: 'medium',
          title: 'Observed tool schema budget',
          summary: `${server.configuredName} exposes ${tools.length} statically configured tool metadata entries (${Buffer.byteLength(serialized, 'utf8')} bytes observed).`,
          impact: 'Tool metadata can consume context, but this static inventory is not a universal provider prompt total.',
          evidence: [{ id: `${server.id}:budget`, kind: 'metric', summary: `${estimate[0]?.tokens ?? 0} estimated tokens using ${estimate[0]?.estimator ?? 'byte-fallback'}`, value: estimate[0]?.tokens ?? 0, sourceId: server.sourceId, evidenceClass: 'static' }],
          remediation: 'Use an explicit provider limit or an approved probe before changing server configuration.',
          references,
          observed: false,
          scoreEligible: false,
        });
      });
    },
  },
  {
    id: 'CTX003', doctor: 'context', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const active = environment.instructions.filter((document) => document.active);
      const groups = new Map<string, typeof active>();
      for (const document of active) {
        const group = groups.get(document.textHash) ?? [];
        group.push(document);
        groups.set(document.textHash, group);
      }
      const findings: Finding[] = [];
      for (const documents of groups.values()) {
        if (documents.length < 2) continue;
        const first = documents[0];
        if (!first) continue;
        findings.push(createFinding(environment, {
          ruleId: 'CTX003', doctor: 'context', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
          title: 'Exact instruction duplicate',
          summary: `${documents.length} active instruction sources have identical content.`,
          impact: 'The duplicate bytes are observed in the effective environment and add avoidable context overhead.',
          evidence: documents.map((document) => ({ id: document.id, kind: 'comparison' as const, summary: document.path, sourceId: document.sourceId, location: document.sourceSpan, evidenceClass: 'static' as const })),
          remediation: 'Keep the highest-precedence copy and remove or narrow the lower-precedence duplicate after review.',
          references,
          locations: documents.map((document) => document.sourceSpan),
          observed: true,
          scoreEligible: true,
          scoreImpact: 4,
          fixSafety: 'review',
        }));
      }
      return findings;
    },
  },
  {
    id: 'CTX004', doctor: 'context', defaultSeverity: 'info', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      const active = environment.instructions.filter((document) => document.active);
      const findings: Finding[] = [];
      for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
        const left = active[leftIndex];
        if (!left) continue;
        const leftWords = new Set(left.content.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
        for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
          const right = active[rightIndex];
          if (!right) continue;
          const rightWords = new Set(right.content.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
          if (leftWords.size === 0 || rightWords.size === 0) continue;
          let intersection = 0;
          for (const word of leftWords) if (rightWords.has(word)) intersection += 1;
          const union = new Set([...leftWords, ...rightWords]).size;
          if (intersection / union < 0.8) continue;
          findings.push(createFinding(environment, {
            ruleId: 'CTX004', doctor: 'context', severity: 'info', evidenceClass: 'heuristic', confidence: 'low',
            title: 'Near-duplicate instruction candidate',
            summary: `${left.path} and ${right.path} share a high Jaccard word overlap.`,
            impact: 'This heuristic may indicate repeated guidance; it is not a semantic equivalence claim.',
            evidence: [{ id: `${left.id}:${right.id}`, kind: 'comparison', summary: `Jaccard overlap ${(intersection / union).toFixed(2)}`, value: Number((intersection / union).toFixed(2)), evidenceClass: 'heuristic' }],
            remediation: 'Compare the source spans manually before consolidating instructions.',
            references,
            locations: [left.sourceSpan, right.sourceSpan],
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
    id: 'CTX005', doctor: 'context', defaultSeverity: 'info', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      return environment.coverageGaps.map((gap) => createFinding(environment, {
        ruleId: 'CTX005', doctor: 'context', severity: 'info', evidenceClass: 'static', confidence: 'certain',
        title: 'Unobserved context component',
        summary: `${gap.area}: ${gap.reason}`,
        impact: 'The report cannot claim a complete initial-context total while this component is unobserved.',
        evidence: [{ id: gap.id, kind: 'coverage', summary: gap.reason, value: gap.area, evidenceClass: 'static' }],
        remediation: 'Use a harness-native export or explicitly selected transcript/baseline mode when available.',
        references,
        observed: false,
        scoreEligible: false,
      }));
    },
  },
  {
    id: 'CTX006', doctor: 'context', defaultSeverity: 'info', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      const limitEntry = Object.entries(environment.unknownFields).find(([key, value]) => /(?:context|token).*(?:limit|window|max)|(?:limit|window|max).*(?:context|token)/i.test(key) && typeof value === 'number' && value > 0);
      const limit = limitEntry?.[1];
      if (typeof limit !== 'number') return [];
      const tokens = environment.instructions.filter((document) => document.active).reduce((sum, document) => sum + (document.tokenEstimates[0]?.tokens ?? 0), 0);
      return [createFinding(environment, {
        ruleId: 'CTX006', doctor: 'context', severity: 'info', evidenceClass: 'static', confidence: 'medium',
        title: 'Observed context share',
        summary: `Observed instruction tokens are approximately ${tokens} of the configured ${limit}-token context window.`,
        impact: 'Only the configured denominator and observed numerator are represented; hidden runtime components remain uncounted.',
        evidence: [{ id: `${environment.harness}:share`, kind: 'metric', summary: `${tokens}/${limit} tokens`, value: tokens, evidenceClass: 'static' }],
        remediation: 'Treat this as an estimate and confirm with a harness-native context report.',
        references,
        observed: true,
        scoreEligible: false,
      })];
    },
  },
];
