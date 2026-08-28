import { createFinding } from '../../core/evidence.js';
import { canonicalToolSignature, duplicateGroups, sameNameCollisions } from '../../core/mcp/identity.js';
import { knownToolLimit } from '../../core/mcp/limits.js';
import type { CheckDefinition, EffectiveEnvironment, Finding } from '../../core/model.js';

const references = ['https://developers.openai.com/codex/mcp', 'https://opencode.ai/docs/mcp-servers/', 'https://cursor.com/docs/context/mcp'];

export const mcpChecks: CheckDefinition[] = [
  {
    id: 'MCP001', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return duplicateGroups(environment.mcpServers.filter((server) => server.enabled && environment.sources.find((source) => source.id === server.sourceId)?.applicable)).map((group) => createFinding(environment, {
        ruleId: 'MCP001', doctor: 'mcp', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Duplicate MCP registration',
        summary: `${group.length} applicable enabled server registrations share one canonical transport identity.`,
        impact: 'The same server may be exposed more than once, multiplying tool metadata and actions.',
        evidence: group.map((server) => ({ id: server.id, kind: 'comparison' as const, summary: `${server.configuredName} → ${server.canonicalIdentity}`, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' as const })),
        remediation: 'Keep the highest-precedence registration and remove the lower-precedence duplicate after previewing a fix plan.',
        references,
        locations: group.flatMap((server) => server.configLocation ? [server.configLocation] : []),
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
        fixSafety: 'safe',
        fixIds: [`fix-mcp-duplicate-${safeId(group[0]?.configuredName ?? 'server')}-${environment.harness}`],
      }));
    },
  },
  {
    id: 'MCP002', doctor: 'mcp', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return sameNameCollisions(environment.mcpServers.filter((server) => server.enabled && environment.sources.find((source) => source.id === server.sourceId)?.applicable)).map((group) => createFinding(environment, {
        ruleId: 'MCP002', doctor: 'mcp', severity: 'error', evidenceClass: 'static', confidence: 'certain',
        title: 'MCP name collision',
        summary: `${group[0]?.configuredName ?? 'A server'} maps to different canonical targets.`,
        impact: 'Name-based tool routing may select an unexpected target or expose an ambiguous namespace.',
        evidence: group.map((server) => ({ id: server.id, kind: 'comparison' as const, summary: server.canonicalIdentity, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' as const })),
        remediation: 'Rename one registration or make the target identity and scope explicit.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 12,
        fixSafety: 'review',
      }));
    },
  },
  {
    id: 'MCP003', doctor: 'mcp', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const groups = new Map<string, typeof environment.tools>();
      for (const tool of environment.tools) {
        const group = groups.get(tool.name) ?? [];
        group.push(tool);
        groups.set(tool.name, group);
      }
      return [...groups.entries()].filter(([, tools]) => tools.length > 1).map(([name, tools]) => createFinding(environment, {
        ruleId: 'MCP003', doctor: 'mcp', severity: 'error', evidenceClass: 'static', confidence: 'certain',
        title: 'Duplicate effective tool name',
        summary: `${name} appears ${tools.length} times in the effective tool inventory.`,
        impact: 'Tool dispatch or approval prompts may be ambiguous.',
        evidence: tools.map((tool, index) => ({ id: `${name}:${index}`, kind: 'comparison' as const, summary: canonicalToolSignature(tool), value: name, evidenceClass: 'static' as const })),
        remediation: 'Rename or disable one conflicting tool source, then re-run the effective-environment scan.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 12,
        fixSafety: 'review',
      }));
    },
  },
  {
    id: 'MCP004', doctor: 'mcp', defaultSeverity: 'info', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      const servers = environment.mcpServers.filter((server) => server.active && server.toolInventory);
      const findings: Finding[] = [];
      for (let index = 0; index < servers.length; index += 1) {
        const left = servers[index];
        if (!left) continue;
        const leftNames = new Set((left.toolInventory?.tools ?? []).map((tool) => tool.name));
        for (let rightIndex = index + 1; rightIndex < servers.length; rightIndex += 1) {
          const right = servers[rightIndex];
          if (!right) continue;
          const overlap = (right.toolInventory?.tools ?? []).map((tool) => tool.name).filter((name) => leftNames.has(name));
          if (overlap.length === 0) continue;
          findings.push(createFinding(environment, {
            ruleId: 'MCP004', doctor: 'mcp', severity: 'info', evidenceClass: 'heuristic', confidence: 'medium',
            title: 'Overlapping MCP toolset',
            summary: `${left.configuredName} and ${right.configuredName} share ${overlap.length} normalized tool name(s).`,
            impact: 'Overlapping names may increase routing ambiguity; this is not proof of a collision without schemas.',
            evidence: [{ id: `${left.id}:${right.id}`, kind: 'comparison', summary: overlap.sort().join(', '), evidenceClass: 'heuristic' }],
            remediation: 'Review overlapping tool schemas and exposed namespaces.',
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
    id: 'MCP005', doctor: 'mcp', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const limit = knownToolLimit(environment);
      if (!limit) return [];
      const count = environment.tools.length;
      if (count <= limit.value) return [];
      return [createFinding(environment, {
        ruleId: 'MCP005', doctor: 'mcp', severity: 'error', evidenceClass: 'static', confidence: 'high',
        title: 'Configured tool limit exceeded',
        summary: `${count} effective tools exceed the explicit ${limit.value}-tool limit.`,
        impact: 'The configured provider or user policy may reject or truncate the effective tool inventory.',
        evidence: [{ id: `${environment.harness}:limit`, kind: 'metric', summary: `limit ${limit.value} from ${limit.source}`, value: count, evidenceClass: 'static' }],
        remediation: 'Reduce the effective inventory or update the explicitly documented limit policy.',
        references: [...references, limit.source],
        observed: true,
        scoreEligible: true,
        scoreImpact: 12,
      })];
    },
  },
  {
    id: 'MCP006', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const limit = knownToolLimit(environment);
      if (!limit) return [];
      const count = environment.tools.length;
      if (count <= Math.floor(limit.value * 0.9) || count > limit.value) return [];
      return [createFinding(environment, {
        ruleId: 'MCP006', doctor: 'mcp', severity: 'warning', evidenceClass: 'static', confidence: 'high',
        title: 'Tool inventory approaches configured limit',
        summary: `${count} effective tools are within 10% of the explicit ${limit.value}-tool limit.`,
        impact: 'Small configuration changes may push the effective inventory over the configured limit.',
        evidence: [{ id: `${environment.harness}:limit-risk`, kind: 'metric', summary: `limit ${limit.value}`, value: count, evidenceClass: 'static' }],
        remediation: 'Monitor inventory growth and keep the documented limit source current.',
        references: [...references, limit.source],
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      })];
    },
  },
  {
    id: 'MCP007', doctor: 'mcp', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    async run(environment, services) {
      const findings: Finding[] = [];
      for (const server of environment.mcpServers.filter((entry) => entry.active && entry.transport === 'stdio' && entry.command)) {
        const resolved = await services.resolveExecutable(server.command as string, server.cwd ?? environment.workspace);
        if (resolved) continue;
        findings.push(createFinding(environment, {
          ruleId: 'MCP007', doctor: 'mcp', severity: 'error', evidenceClass: 'static', confidence: 'certain',
          title: 'MCP executable unresolved',
          summary: `${server.configuredName} command ${server.command} was not found using platform executable rules.`,
          impact: 'The configured stdio server cannot be launched from its declared working directory.',
          evidence: [{ id: server.id, kind: 'configuration', summary: server.command as string, value: server.command as string, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' }],
          remediation: 'Install the executable, use an absolute supported path, or correct the server command.',
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
    id: 'MCP008', doctor: 'mcp', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment, services) {
      const findings: Finding[] = [];
      for (const server of environment.mcpServers.filter((entry) => entry.active)) {
        const missing = server.envKeyNames.filter((key) => /^\$\{[^}]+\}$/.test(key) && !services.envNames?.some((name) => services.platform === 'win32' ? name.toLowerCase() === key.slice(2, -1).toLowerCase() : name === key.slice(2, -1)));
        if (missing.length === 0) continue;
        findings.push(createFinding(environment, {
          ruleId: 'MCP008', doctor: 'mcp', severity: 'error', evidenceClass: 'static', confidence: 'certain',
          title: 'MCP environment reference missing',
          summary: `${server.configuredName} references environment keys that are not present.`,
          impact: 'The server may start with incomplete credentials or configuration.',
          evidence: [{ id: server.id, kind: 'configuration', summary: missing.join(', '), sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' }],
          remediation: 'Provide the referenced keys in the approved runtime environment; values are never printed by Harness Medic.',
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
    id: 'MCP014', doctor: 'mcp', defaultSeverity: 'info', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      return environment.mcpServers.filter((server) => !server.active || !server.enabled).map((server) => createFinding(environment, {
        ruleId: 'MCP014', doctor: 'mcp', severity: 'info', evidenceClass: 'static', confidence: 'certain',
        title: 'Disabled or shadowed MCP registration',
        summary: `${server.configuredName} is configured but is not active in the effective environment.`,
        impact: 'Static configuration exposure does not imply that this server is available at runtime.',
        evidence: [{ id: server.id, kind: 'comparison', summary: 'inactive registration retained for provenance', sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' }],
        remediation: 'Remove stale configuration or promote it intentionally; no automatic enablement is performed.',
        references,
        observed: true,
        scoreEligible: false,
      }));
    },
  },
  {
    id: 'MCP009', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && server.observation?.status === 'failed' && observationPhase(server.observation) === 'startup').map((server) => runtimeFinding(environment, server, 'MCP009', 'MCP startup failed', 'The bounded runtime probe could not complete initialization; static configuration remains separate.', 'Review the startup error and target process without treating it as a permanent availability claim.'));
    },
  },
  {
    id: 'MCP010', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && server.observation?.status === 'observed' && (server.observation.durationMs ?? 0) > 5000).map((server) => runtimeFinding(environment, server, 'MCP010', 'MCP startup or listing is slow', 'The observed probe exceeded the bounded five-second responsiveness threshold.', 'Investigate server startup and tools/list latency; no universal availability claim is made.'));
    },
  },
  {
    id: 'MCP011', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && server.observation?.status === 'failed' && observationPhase(server.observation) === 'tools/list').map((server) => runtimeFinding(environment, server, 'MCP011', 'MCP tools listing failed', 'Initialization completed but the observed tools/list request failed.', 'Review the server protocol response and retry only with explicit consent.'));
    },
  },
  {
    id: 'MCP012', doctor: 'mcp', defaultSeverity: 'info', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && (server.observation?.attempts ?? 0) > 1).map((server) => runtimeFinding(environment, server, 'MCP012', 'MCP probe retried after a transient failure', 'The bounded supervisor needed more than one attach attempt before returning its observed result.', 'Review the attempt timeline and server stability; retries are not proof of permanent failure.'));
    },
  },
  {
    id: 'MCP013', doctor: 'mcp', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      const findings: Finding[] = [];
      for (const server of environment.mcpServers.filter((entry) => entry.active && entry.toolInventory?.observed)) {
        const baseline = server.rawMetadata?.['baselineToolHashes'];
        if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) continue;
        const old = baseline as Record<string, unknown>;
        for (const tool of server.toolInventory?.tools ?? []) {
          if (typeof old[tool.name] !== 'string' || !tool.metadataHash || old[tool.name] === tool.metadataHash) continue;
          const sensitive = /(?:password|token|secret|credential|api[_-]?key|private[_-]?key|filesystem|command|shell)/i.test(JSON.stringify(tool));
          findings.push(runtimeFinding(environment, server, 'MCP013', sensitive ? 'Sensitive MCP schema drift' : 'MCP schema drift', `Observed metadata for ${tool.name} changed since the selected baseline.`, 'Review the changed metadata and update the baseline only after approval.', sensitive ? 'critical' : 'warning'));
        }
      }
      return findings;
    },
  },
];

function observationPhase(observation: NonNullable<EffectiveEnvironment['mcpServers'][number]['observation']>): 'startup' | 'tools/list' {
  return observation.evidence.some((entry) => entry.value.includes(':tools/list')) ? 'tools/list' : 'startup';
}

function runtimeFinding(environment: EffectiveEnvironment, server: EffectiveEnvironment['mcpServers'][number], ruleId: string, title: string, impact: string, remediation: string, severity: Finding['severity'] = 'warning'): Finding {
  const observation = server.observation;
  return createFinding(environment, {
    ruleId, doctor: 'mcp', severity, evidenceClass: 'runtime', confidence: 'high', title,
    summary: `${server.configuredName} observation is ${observation?.status ?? 'not-run'}.`,
    impact,
    evidence: (observation?.evidence ?? []).map((entry, index) => ({ id: `${server.id}:${index}`, kind: 'observation' as const, summary: entry.value, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'runtime' as const })),
    remediation,
    references,
    locations: server.configLocation ? [server.configLocation] : [],
    observed: observation?.status === 'observed' || observation?.status === 'failed' || observation?.status === 'timed-out',
    scoreEligible: false,
  });
}
function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'server';
}
