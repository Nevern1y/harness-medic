import type { Command } from 'commander';
import { checkById } from '../../checks/index.js';

export function runExplainCommand(ruleId: string, command: Command): number {
  const check = checkById(ruleId.toUpperCase());
  if (!check) {
    command.error(`Unknown rule ID ${ruleId}`, { exitCode: 2 });
    return 2;
  }
  process.stdout.write(`${check.id}\nDoctor       ${check.doctor}\nEvidence     ${check.evidenceClass}\nSeverity     ${check.defaultSeverity}\nScoreable    ${check.scoreEligible ? 'yes' : 'no'}\nReferences   ${check.references.join(', ')}\n`);
  return 0;
}
