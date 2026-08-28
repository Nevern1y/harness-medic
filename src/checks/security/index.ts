import { createFinding } from '../../core/evidence.js';
import { redactText } from '../../core/redaction.js';
import type { CheckDefinition, EffectiveEnvironment, Finding } from '../../core/model.js';

const references = ['https://owasp.org/www-community/attacks/MCP_Tool_Poisoning', 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools'];
const suspiciousPattern = /(?:ignore\s+(?:the|all|previous)\s+(?:system\s+)?instructions?|do\s+not\s+tell\s+(?:the\s+)?user|send\s+(?:the\s+)?(?:token|password|credential|secret)|upload\s+.*(?:credential|secret)|reveal\s+(?:the\s+)?system\s+prompt)/i;
const sensitiveName = /(?:password|token|secret|credential|api[_-]?key|private[_-]?key|environment|filesystem|path|directory|network|url)/i;
const destructiveName = /(?:delete|remove|write|execute|shell|terminal|command|modify|destroy|overwrite)/i;
interface BaselineDriftMarker {
  id: string;
  label: string;
  summary: string;
  previous?: string;
  current?: string;
  sensitive: boolean;
  sourceId?: string;
  location?: Finding['locations'][number];
}

export function createRugPullFinding(environment: EffectiveEnvironment, marker: BaselineDriftMarker): Finding {
  const transition = `${marker.previous ?? '[absent]'} → ${marker.current ?? '[absent]'}`;
  return createFinding(environment, {
    ruleId: 'SEC012', doctor: 'security', severity: marker.sensitive ? 'critical' : 'warning', evidenceClass: 'runtime', confidence: 'certain',
    title: marker.sensitive ? 'Sensitive approved metadata drift' : 'Approved metadata drift',
    summary: marker.summary,
    impact: marker.sensitive ? 'A previously approved capability may have gained a sensitive or destructive surface.' : 'Previously approved MCP metadata or target identity changed and requires review.',
    evidence: [{ id: marker.id, kind: 'comparison', summary: `${marker.label}: ${transition}`, ...(marker.sourceId ? { sourceId: marker.sourceId } : {}), ...(marker.location ? { location: marker.location } : {}), evidenceClass: 'runtime' }],
    ...(marker.location ? { locations: [marker.location] } : {}),
    remediation: 'Review the changed metadata or target, update the baseline only after approval, and do not treat drift as proof of compromise.',
    references,
    observed: true,
    scoreEligible: false,
  });
}

function baselineDriftMarkers(environment: EffectiveEnvironment): BaselineDriftMarker[] {
  const value = environment.unknownFields['baseline.rugPull'];
  if (!Array.isArray(value)) return [];
  return value.filter(isBaselineDriftMarker);
}

function isBaselineDriftMarker(value: unknown): value is BaselineDriftMarker {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { label?: unknown }).label === 'string'
    && typeof (value as { summary?: unknown }).summary === 'string'
    && typeof (value as { sensitive?: unknown }).sensitive === 'boolean';
}


function allToolText(environment: EffectiveEnvironment): Array<{ serverId: string; sourceId: string; trust: string; text: string; toolName: string }> {
  const output: Array<{ serverId: string; sourceId: string; trust: string; text: string; toolName: string }> = [];
  for (const server of environment.mcpServers.filter((entry) => entry.active)) {
    for (const tool of server.toolInventory?.tools ?? []) output.push({ serverId: server.id, sourceId: server.sourceId, trust: server.trust, text: `${tool.name} ${tool.description ?? ''} ${JSON.stringify(tool.inputSchema ?? {})}`, toolName: tool.name });
    for (const [key, value] of Object.entries(server.rawMetadata ?? {})) {
      if (!/(?:description|instruction|prompt|message|metadata)/i.test(key)) continue;
      output.push({ serverId: server.id, sourceId: server.sourceId, trust: server.trust, text: `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`, toolName: server.configuredName });
    }
  }
  return output;
}

export const securityChecks: CheckDefinition[] = [
  {
    id: 'SEC001', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      return allToolText(environment).filter((entry) => suspiciousPattern.test(entry.text)).map((entry) => createFinding(environment, {
        ruleId: 'SEC001', doctor: 'security', severity: 'warning', evidenceClass: 'heuristic', confidence: 'medium',
        title: 'Suspicious metadata instruction pattern',
        summary: `${entry.toolName} contains metadata resembling an instruction to override guidance or disclose sensitive data.`,
        impact: 'Tool and server metadata are untrusted input; a match is a risk indicator, not proof of maliciousness.',
        evidence: [{ id: entry.serverId, kind: 'span', summary: redactText(entry.text.match(suspiciousPattern)?.[0] ?? 'suspicious directive'), sourceId: entry.sourceId, evidenceClass: 'heuristic' }],
        remediation: 'Review the server/tool owner, trust boundary, and exact metadata before approving use.',
        references,
        observed: true,
        scoreEligible: false,
        precisionStatus: 'unmeasured',
      }));
    },
  },
  {
    id: 'SEC002', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      const tools = allToolText(environment);
      const trustRank: Record<string, number> = { managed: 0, user: 1, workspace: 2, 'third-party': 3, unknown: 4 };
      const findings: Finding[] = [];
      for (let leftIndex = 0; leftIndex < tools.length; leftIndex += 1) {
        const left = tools[leftIndex];
        if (!left) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < tools.length; rightIndex += 1) {
          const right = tools[rightIndex];
          if (!right || left.toolName.toLowerCase() !== right.toolName.toLowerCase() || left.serverId === right.serverId) continue;
          if ((trustRank[left.trust] ?? 4) === (trustRank[right.trust] ?? 4)) continue;
          const lessTrusted = (trustRank[left.trust] ?? 4) > (trustRank[right.trust] ?? 4) ? left : right;
          const moreTrusted = lessTrusted.serverId === left.serverId ? right : left;
          findings.push(createFinding(environment, {
            ruleId: 'SEC002', doctor: 'security', severity: 'warning', evidenceClass: 'heuristic', confidence: 'medium',
            title: 'Cross-server tool name shadowing',
            summary: `${lessTrusted.toolName} is exposed by a less-trusted MCP server alongside a higher-trust capability.`,
            impact: 'A less-trusted server may imitate a capability name; names alone do not prove identical behavior.',
            evidence: [{ id: `${lessTrusted.serverId}:${moreTrusted.serverId}`, kind: 'comparison', summary: `${lessTrusted.toolName} spans ${lessTrusted.trust} and ${moreTrusted.trust} trust boundaries`, sourceId: lessTrusted.sourceId, evidenceClass: 'heuristic' }],
            remediation: 'Compare schemas, trust, approval policy, and canonical targets before allowing both tools.',
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
    id: 'SEC003', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return allToolText(environment).filter((entry) => destructiveName.test(entry.text)).map((entry) => createFinding(environment, {
        ruleId: 'SEC003', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Destructive MCP capability',
        summary: `${entry.toolName} appears to expose write, delete, shell, or execute behavior.`,
        impact: 'The capability warrants explicit trust and approval review before runtime use.',
        evidence: [{ id: entry.serverId, kind: 'configuration', summary: redactText(entry.text.slice(0, 240)), sourceId: entry.sourceId, evidenceClass: 'static' }],
        remediation: 'Require explicit approval, narrow schema parameters, and verify the server trust boundary.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'SEC004', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    run(environment) {
      return allToolText(environment).filter((entry) => sensitiveName.test(entry.text) && /(?:schema|properties|parameter|input)/i.test(entry.text)).map((entry) => createFinding(environment, {
        ruleId: 'SEC004', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Sensitive MCP parameter surface',
        summary: `${entry.toolName} metadata includes a credential, filesystem, environment, or network-sensitive parameter name.`,
        impact: 'Sensitive parameters expand the capability trust boundary; this static indicator is not a claim that data was accessed.',
        evidence: [{ id: entry.serverId, kind: 'configuration', summary: redactText(entry.text.match(sensitiveName)?.[0] ?? 'sensitive parameter'), sourceId: entry.sourceId, evidenceClass: 'static' }],
        remediation: 'Review the parameter necessity, approval mode, and server owner; never paste secret values into reports.',
        references,
        observed: true,
        scoreEligible: false,
      }));
    },
  },
  {
    id: 'SEC005', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return allToolText(environment).filter((entry) => /(?:filesystem|file[_-]?system|root|directory|glob|path)/i.test(entry.text)).map((entry) => createFinding(environment, {
        ruleId: 'SEC005', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Broad filesystem scope indicator',
        summary: `${entry.toolName} appears to reference a broad filesystem or root path capability.`,
        impact: 'Broad scope increases the impact of an unintended or compromised tool action.',
        evidence: [{ id: entry.serverId, kind: 'configuration', summary: redactText(entry.text.slice(0, 240)), sourceId: entry.sourceId, evidenceClass: 'static' }],
        remediation: 'Constrain roots and approval policy to the smallest required workspace scope.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'SEC006', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return allToolText(environment).filter((entry) => /(?:shell|terminal|exec(?:ute)?|command)/i.test(entry.text)).map((entry) => createFinding(environment, {
        ruleId: 'SEC006', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Shell capability indicator',
        summary: `${entry.toolName} appears to expose command or shell execution.`,
        impact: 'Command execution can cross workspace and host trust boundaries.',
        evidence: [{ id: entry.serverId, kind: 'configuration', summary: redactText(entry.text.slice(0, 240)), sourceId: entry.sourceId, evidenceClass: 'static' }],
        remediation: 'Require explicit approval, constrain argv and working directory, and verify the trusted server owner.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'SEC007', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && (server.transport === 'sse' || server.transport === 'streamable-http') && server.trust !== 'managed').map((server) => createFinding(environment, {
        ruleId: 'SEC007', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Remote untrusted MCP transport',
        summary: `${server.configuredName} uses ${server.transport} from a non-managed trust scope.`,
        impact: 'Remote metadata and network availability are external trust inputs.',
        evidence: [{ id: server.id, kind: 'configuration', summary: server.url ?? server.canonicalIdentity, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' }],
        remediation: 'Verify the URL, owner, authentication policy, and explicit network consent before probing or enabling the server.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'SEC008', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.mcpServers.filter((server) => server.active && server.transport === 'stdio' && /^(?:npx|npm|pnpm|yarn|bunx)$/i.test(server.command ?? '') && !(server.args ?? []).some(isPinnedPackageArgument)).map((server) => createFinding(environment, {
        ruleId: 'SEC008', doctor: 'security', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Unpinned stdio package launch',
        summary: `${server.configuredName} launches a package runner without an explicit package version.`,
        impact: 'A future package resolution can change executable behavior without a configuration diff.',
        evidence: [{ id: server.id, kind: 'configuration', summary: `${server.command ?? ''} ${(server.args ?? []).join(' ')}`, sourceId: server.sourceId, location: server.configLocation, evidenceClass: 'static' }],
        remediation: 'Pin the package version and review lockfile/provenance before enabling the server.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'SEC009', doctor: 'security', defaultSeverity: 'critical', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      const dangerous = allToolText(environment).filter((entry) => destructiveName.test(entry.text));
      const autoApproved = environment.permissions.some((permission) => permission.active && permission.mode === 'allow' && /(?:execute|write|delete|shell|terminal)/i.test(permission.action));
      if (dangerous.length === 0 || !autoApproved) return [];
      return [createFinding(environment, {
        ruleId: 'SEC009', doctor: 'security', severity: 'critical', evidenceClass: 'static', confidence: 'high',
        title: 'Dangerous tool appears auto-approved',
        summary: 'A destructive capability overlaps an allow-mode permission rule.',
        impact: 'The combination can bypass an intended human approval boundary.',
        evidence: [{ id: `${environment.harness}:approval`, kind: 'comparison', summary: 'destructive capability plus allow permission', evidenceClass: 'static' }],
        remediation: 'Change the permission to ask/deny and review the dangerous tool scope before any runtime use.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 25,
      })];
    },
  },
  {
    id: 'SEC010', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      return environment.hooks.filter((hook) => /(?:env|credential|token|password|secret|home|ssh|config)/i.test(hook.target) && /(?:curl|wget|nc\b|invoke-webrequest|http|upload|post)/i.test(hook.target)).map((hook) => createFinding(environment, {
        ruleId: 'SEC010', doctor: 'security', severity: 'warning', evidenceClass: 'heuristic', confidence: 'medium',
        title: 'Hook data-flow exfiltration indicator',
        summary: `${hook.target} combines a sensitive source pattern with a network sink pattern.`,
        impact: 'This source-aware static indicator is not proof that a hook executed or exfiltrated data.',
        evidence: [{ id: hook.id, kind: 'span', summary: 'sensitive source and network sink patterns matched', sourceId: hook.sourceId, location: hook.location, evidenceClass: 'heuristic' }],
        remediation: 'Review the exact command, trust boundary, and network destination; do not execute it as part of static scanning.',
        references,
        observed: true,
        scoreEligible: false,
        precisionStatus: 'unmeasured',
      }));
    },
  },
  {
    id: 'SEC011', doctor: 'security', defaultSeverity: 'critical', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.sources.flatMap((source) => source.diagnostics.filter((diagnostic) => diagnostic.code === 'PLAINTEXT_SECRET').map((diagnostic) => createFinding(environment, {
        ruleId: 'SEC011', doctor: 'security', severity: 'critical', evidenceClass: 'static', confidence: 'certain',
        title: 'Plaintext secret detected and redacted',
        summary: `${source.path} contains a value matching a structural secret detector.`,
        impact: 'The source may leak credentials if committed or loaded by an untrusted process; the value is intentionally not shown.',
        evidence: [{ id: `${source.id}:secret`, kind: 'configuration', summary: 'structural detector matched; value redacted', sourceId: source.id, location: diagnostic.location, evidenceClass: 'static' }],
        remediation: 'Rotate the credential, replace it with an approved environment reference, and remove the plaintext value from disk.',
        references,
        locations: [{ path: source.path }],
        observed: true,
        scoreEligible: true,
        scoreImpact: 25,
        fixSafety: 'manual',
      })));
    },
  },
  {
    id: 'SEC012', doctor: 'security', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return baselineDriftMarkers(environment).map((marker) => createRugPullFinding(environment, marker));
    },
  },
];
function isPinnedPackageArgument(argument: string): boolean {
  if (argument.startsWith('-')) return false;
  return /(?:^|\/)@?[^@\s/]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(argument) || /^@[^/\s]+\/[^@\s]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(argument);
}
