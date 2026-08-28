import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { contextFromOptions, type CommonCliOptions } from '../options.js';
import { sha256 } from '../../core/fs.js';
import { scanWorkspace } from '../../core/scan.js';
import { planFixes } from '../../fixes/planner.js';
import { applyFixPlan } from '../../fixes/transaction.js';
import { formatJson, writeJsonAtomically } from '../../reporters/json.js';
import { formatTerminal } from '../../reporters/terminal.js';
import { redactText } from '../../core/redaction.js';
import type { FixPlan, ScanReport } from '../../core/model.js';

export async function runFixCommand(ids: string[], options: CommonCliOptions): Promise<number> {
  const context = contextFromOptions(options);
  const execution = await scanWorkspace({ cwd: context.cwd, home: context.home, selectedHarnesses: context.selectedHarnesses, envNames: context.envNames, platform: context.platform, consentPolicy: context.consentPolicy, noScore: options.score === false });
  const planned = await planFixes(execution.report, execution.services);
  const explicitlySelected = ids.length > 0;
  const selected = planned.plans.filter((plan) => {
    const matches = ids.length === 0 || ids.includes(plan.id) || plan.findingIds.some((id) => ids.includes(id));
    const touchesUserScope = plan.operations.some((operation) => execution.report.environments.some((environment) => environment.sources.some((source) => source.path === operation.path && source.scope === 'user')));
    return matches && (!touchesUserScope || explicitlySelected) && (options.safe ? plan.safety === 'safe' : true);
  });
  execution.report.fixPlans = selected;
  if (planned.diagnostics.length > 0) execution.report.internalDiagnostics.push(...planned.diagnostics.map((message, index) => ({ id: `fix-plan:${index}`, phase: 'fix' as const, message, recoverable: true })));
  if (options.apply && !options.dryRun && !explicitlySelected && !options.safe) {
    process.stderr.write('Refusing to apply fixes without finding IDs or --safe. Preview with --dry-run, then select an explicit safe plan.\n');
    await emitFixReport(execution.report, options);
    return 2;
  }
  if (options.apply && !options.dryRun && selected.length > 0) {
    const batch = batchFixPlans(selected);
    const result = await applyFixPlan(batch, execution.services, {
      dryRun: false,
      validate: async () => {
        const after = await scanWorkspace({ cwd: context.cwd, home: context.home, selectedHarnesses: context.selectedHarnesses, envNames: context.envNames, platform: context.platform, consentPolicy: context.consentPolicy, fs: execution.services.fs });
        const remaining = after.report.findings.filter((finding) => finding.ruleId === 'MCP001' && finding.locations.some((location) => batch.affectedPaths.includes(location.path)));
        if (remaining.length > 0) throw new Error(`Post-write reconstruction still reports ${remaining.length} duplicate registration finding(s)`);
      },
    });
    if (result.status !== 'committed') {
      await emitFixReport(execution.report, options);
      return result.code;
    }
  }
  await emitFixReport(execution.report, options);
  return 0;
}

function batchFixPlans(plans: FixPlan[]): FixPlan {
  const first = plans[0];
  if (!first) throw new Error('Cannot batch an empty fix selection');
  const preconditions = new Map<string, { path: string; contentHash: string }>();
  for (const plan of plans) {
    for (const precondition of plan.preconditions) {
      const existing = preconditions.get(precondition.path);
      if (existing && existing.contentHash !== precondition.contentHash) throw new Error(`Selected fix plans disagree on the precondition for ${precondition.path}`);
      preconditions.set(precondition.path, precondition);
    }
  }
  return {
    ...first,
    id: plans.length === 1 ? first.id : `fix-batch-${sha256(plans.map((plan) => plan.id).join('|')).slice(0, 12)}`,
    findingIds: [...new Set(plans.flatMap((plan) => plan.findingIds))].sort(),
    operations: plans.flatMap((plan) => plan.operations),
    preconditions: [...preconditions.values()].sort((left, right) => left.path.localeCompare(right.path)),
    postconditions: plans.flatMap((plan) => plan.postconditions),
    affectedPaths: [...new Set(plans.flatMap((plan) => plan.affectedPaths))].sort(),
    preview: plans.map((plan) => plan.preview).join('\n'),
  };
}

async function emitFixReport(report: ScanReport, options: CommonCliOptions): Promise<void> {
  if (options.format === 'json') {
    if (options.output) await writeJsonAtomically(path.resolve(options.output), report);
    else process.stdout.write(formatJson(report));
    return;
  }
  const text = `${formatTerminal(report, { color: options.color !== false, verbose: options.verbose })}\nFix plans\n${report.fixPlans.map((plan) => `- ${redactText(plan.id)} [${redactText(plan.safety)}]\n  ${redactText(plan.preview)}`).join('\n') || '- none'}\n`;
  if (options.output) {
    await writeTextAtomically(path.resolve(options.output), text);
  } else process.stdout.write(text);
}

async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  const resolved = path.resolve(filePath);
  await nodeFs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await nodeFs.writeFile(temporary, content, 'utf8');
    await nodeFs.rename(temporary, resolved);
  } finally {
    await nodeFs.unlink(temporary).catch(() => undefined);
  }
}
