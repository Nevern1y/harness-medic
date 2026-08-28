import path from 'node:path';
import { normalizePathForIdentity, resolvePathFrom } from '../../core/fs.js';
import { createFinding } from '../../core/evidence.js';
import type { CheckDefinition, Finding, HookRegistration } from '../../core/model.js';
const references = ['https://code.claude.com/docs/en/hooks', 'https://developers.openai.com/codex/hooks'];

export const hookChecks: CheckDefinition[] = [
  {
    id: 'HOOK001', doctor: 'hooks', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.hooks.filter((hook) => hook.validation.some((entry) => entry.code === 'event' && !entry.valid)).map((hook) => createFinding(environment, {
        ruleId: 'HOOK001', doctor: 'hooks', severity: 'error', evidenceClass: 'static', confidence: 'certain',
        title: 'Invalid hook event',
        summary: `${hook.event} is not recognized by the supported static hook schema.`,
        impact: 'The registration may never be considered by the harness.',
        evidence: [{ id: hook.id, kind: 'configuration', summary: hook.event, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
        remediation: 'Use a documented event name for this harness and rerun the static check.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 12,
      }));
    },
  },
  {
    id: 'HOOK002', doctor: 'hooks', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.hooks.filter((hook) => hook.validation.some((entry) => entry.code === 'matcher' && !entry.valid)).map((hook) => createFinding(environment, {
        ruleId: 'HOOK002', doctor: 'hooks', severity: 'error', evidenceClass: 'static', confidence: 'certain',
        title: 'Invalid hook matcher',
        summary: `${hook.event} has an empty or unsupported matcher shape.`,
        impact: 'The matcher may disable or over-broaden the hook registration.',
        evidence: [{ id: hook.id, kind: 'configuration', summary: hook.matcher ?? '', sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
        remediation: 'Correct the matcher according to the harness schema; no hook command is executed by this check.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 12,
      }));
    },
  },
  {
    id: 'HOOK003', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.hooks.filter((hook) => hook.matcher === '' || (hook.matcher === undefined && hook.event === 'PreToolUse')).map((hook) => createFinding(environment, {
        ruleId: 'HOOK003', doctor: 'hooks', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Hook matcher may have an empty match domain',
        summary: `${hook.event} has no bounded matcher.`,
        impact: 'The hook may apply to more events or tools than intended.',
        evidence: [{ id: hook.id, kind: 'configuration', summary: hook.event, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
        remediation: 'Add an explicit matcher when the harness supports one, or document why the broad scope is intentional.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'HOOK004', doctor: 'hooks', defaultSeverity: 'error', evidenceClass: 'static', scoreEligible: true, references,
    async run(environment, services) {
      const findings = [];
      for (const hook of environment.hooks.filter((entry) => entry.active && entry.kind === 'command' && entry.target)) {
        const command = firstShellWord(hook.target);
        const resolved = await services.resolveExecutable(command, environment.workspace);
        if (resolved) continue;
        findings.push(createFinding(environment, {
          ruleId: 'HOOK004', doctor: 'hooks', severity: 'error', evidenceClass: 'static', confidence: 'certain',
          title: 'Hook target unresolved',
          summary: `${hook.target} cannot be resolved from the harness-defined working directory.`,
          impact: 'The hook may be skipped or fail when invoked.',
          evidence: [{ id: hook.id, kind: 'configuration', summary: hook.target, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
          remediation: 'Use an installed executable or an explicit path with the correct working directory.',
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
    id: 'HOOK005', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    run(environment, services) {
      return environment.hooks.filter((hook) => {
        const isWindows = services.platform === 'win32' || (services.platform === undefined && process.platform === 'win32');
        const expected = expectedPath(hook.target, environment.workspace, isWindows);
        return Boolean(expected && hook.resolvedTarget && normalizePath(expected, isWindows) !== normalizePath(hook.resolvedTarget, isWindows));
      }).map((hook) => createFinding(environment, {
        ruleId: 'HOOK005', doctor: 'hooks', severity: 'warning', evidenceClass: 'static', confidence: 'medium',
        title: 'Hook target identity collision',
        summary: `${hook.target} resolves to a different path than its explicit target.`,
        impact: 'A path or working-directory mismatch can execute a same-named script from an unintended location.',
        evidence: [{ id: hook.id, kind: 'comparison', summary: `${hook.target} → ${hook.resolvedTarget ?? 'unresolved'}`, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
        remediation: 'Use the intended absolute or workspace-relative path and verify its resolved executable before enabling the hook.',
        references,
        observed: true,
        scoreEligible: false,
      }));
    },
  },
  {
    id: 'HOOK006', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: false, references,
    async run(environment, services) {
      const findings = [];
      for (const hook of environment.hooks.filter((entry) => entry.active && entry.kind === 'command' && entry.resolvedTarget && services.fs && services.platform !== 'win32')) {
        let stats;
        try { stats = await services.fs?.stat(hook.resolvedTarget as string); } catch { continue; }
        if (!stats || (stats.mode & 0o111) !== 0) continue;
        findings.push(createFinding(environment, {
          ruleId: 'HOOK006', doctor: 'hooks', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
          title: 'Hook target is not executable',
          summary: `${hook.resolvedTarget} has no executable permission bits on this POSIX platform.`,
          impact: 'The harness may not be able to launch the configured hook target.',
          evidence: [{ id: hook.id, kind: 'configuration', summary: hook.resolvedTarget as string, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
          remediation: 'Add executable permission or invoke the script through an explicit trusted interpreter.',
          references,
          observed: true,
          scoreEligible: false,
        }));
      }
      return findings;
    },
  },
  {
    id: 'HOOK007', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'static', scoreEligible: true, references,
    run(environment) {
      return environment.hooks.filter((hook) => hook.active && hook.kind === 'command' && hook.timeout === undefined).map((hook) => createFinding(environment, {
        ruleId: 'HOOK007', doctor: 'hooks', severity: 'warning', evidenceClass: 'static', confidence: 'certain',
        title: 'Hook has no explicit timeout',
        summary: `${hook.event} invokes ${hook.target} without a configured timeout.`,
        impact: 'A hanging hook can block an agent action or session lifecycle.',
        evidence: [{ id: hook.id, kind: 'configuration', summary: hook.target, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'static' }],
        remediation: 'Set a bounded timeout supported by the harness.',
        references,
        observed: true,
        scoreEligible: true,
        scoreImpact: 4,
      }));
    },
  },
  {
    id: 'HOOK008', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      return environment.hooks.filter((hook) => /(?:\|\|\s*true|;\s*exit\s+0|ignore\s+error|continue\s+on\s+error)/i.test(hook.target)).map((hook) => createFinding(environment, {
        ruleId: 'HOOK008', doctor: 'hooks', severity: 'warning', evidenceClass: 'heuristic', confidence: 'medium',
        title: 'Hook command may fail open',
        summary: `${hook.target} contains a construct that can mask a failure.`,
        impact: 'A failed validation may be treated as successful; the static match is not a runtime claim.',
        evidence: [{ id: hook.id, kind: 'span', summary: 'fail-open shell construct matched', sourceId: hook.sourceId, location: hook.location, evidenceClass: 'heuristic' }],
        remediation: 'Review the command and make failure behavior explicit for the harness.',
        references,
        observed: true,
        scoreEligible: false,
        precisionStatus: 'unmeasured',
      }));
    },
  },
  {
    id: 'HOOK009', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'heuristic', scoreEligible: false, references,
    run(environment) {
      return environment.hooks.filter((hook) => /(?:read\s+-p|prompt\(|select\s+|stdin|interactive)/i.test(hook.target)).map((hook) => createFinding(environment, {
        ruleId: 'HOOK009', doctor: 'hooks', severity: 'warning', evidenceClass: 'heuristic', confidence: 'medium',
        title: 'Interactive hook command',
        summary: `${hook.target} appears to require interactive input.`,
        impact: 'A non-TTY agent session may block or fail to provide the expected input.',
        evidence: [{ id: hook.id, kind: 'span', summary: 'interactive command pattern matched', sourceId: hook.sourceId, location: hook.location, evidenceClass: 'heuristic' }],
        remediation: 'Use a non-interactive command or document an explicit TTY-only execution policy.',
        references,
        observed: true,
        scoreEligible: false,
        precisionStatus: 'unmeasured',
      }));
    },
  },
  {
    id: 'HOOK010', doctor: 'hooks', defaultSeverity: 'info', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.hooks.filter((hook) => hook.observation?.status === 'unsupported' || hook.observation?.evidence.some((entry) => entry.kind === 'synthetic' && /not[- ]fired/i.test(entry.value))).map((hook) => runtimeHookFinding(environment, hook, 'HOOK010', 'Hook synthetic firing was not observed', 'No harness-native or approved inert synthetic event produced a fired observation.', 'Use a supported inert hook sandbox before making a runtime firing claim.', 'info'));
    },
  },
  {
    id: 'HOOK011', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.hooks.filter((hook) => hook.observation?.status === 'failed').map((hook) => runtimeHookFinding(environment, hook, 'HOOK011', 'Hook runtime probe failed', 'The approved hook observation returned a failure.', 'Review the bounded hook observation and target without treating it as a permanent availability claim.', 'warning'));
    },
  },
  {
    id: 'HOOK012', doctor: 'hooks', defaultSeverity: 'warning', evidenceClass: 'runtime', scoreEligible: false, references, scanTier: 1, requiredEvidence: ['runtime'],
    run(environment) {
      return environment.hooks.filter((hook) => hook.observation?.status === 'timed-out').map((hook) => runtimeHookFinding(environment, hook, 'HOOK012', 'Hook runtime probe timed out', 'The approved hook observation exceeded its bounded timeout.', 'Review the hook timeout and target in an inert sandbox.', 'warning'));
    },
  },
];

function expectedPath(target: string, workspace: string, isWindows = process.platform === 'win32'): string | undefined {
  const match = target.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const first = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!first) return undefined;
  if (!first.includes('/') && !first.includes('\\') && !(isWindows ? path.win32.isAbsolute(first) : path.posix.isAbsolute(first))) return undefined;
  return resolvePathFrom(workspace, first, isWindows);
}

function normalizePath(value: string, isWindows = process.platform === 'win32'): string {
  return normalizePathForIdentity(value, isWindows);
}

function runtimeHookFinding(environment: Parameters<CheckDefinition['run']>[0], hook: HookRegistration, ruleId: string, title: string, impact: string, remediation: string, severity: Finding['severity']): Finding {
  const observation = hook.observation;
  return createFinding(environment, {
    ruleId, doctor: 'hooks', severity, evidenceClass: 'runtime', confidence: 'high', title,
    summary: `${hook.event} hook observation is ${observation?.status ?? 'not-run'}.`,
    impact,
    evidence: (observation?.evidence ?? []).map((entry, index) => ({ id: `${hook.id}:${index}`, kind: 'observation' as const, summary: entry.value, sourceId: hook.sourceId, location: hook.location, evidenceClass: 'runtime' as const })),
    locations: hook.location ? [hook.location] : [],
    remediation,
    references,
    observed: observation?.status === 'observed' || observation?.status === 'failed' || observation?.status === 'timed-out',
    scoreEligible: false,
  });
}

function firstShellWord(command: string): string {
  const match = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}