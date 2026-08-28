#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { redactText } from '../core/redaction.js';
import { TOOL_VERSION } from '../core/scan.js';
import { addCommonOptions, commandOptions, type CommonCliOptions } from './options.js';
import { runScanCommand } from './commands/scan.js';
import { runContextCommand } from './commands/context.js';
import { runRulesCommand } from './commands/rules.js';
import { runMcpCommand } from './commands/mcp.js';
import { runHooksCommand } from './commands/hooks.js';
import { runSecurityCommand } from './commands/security.js';
import { runExplainCommand } from './commands/explain.js';
import { runFixCommand } from './commands/fix.js';
import { runBaselineCommand } from './commands/baseline.js';
import { runBenchmarkCommand } from './commands/benchmark.js';

export async function runCli(argv: string[] = process.argv): Promise<number> {
  const program = new Command();
  let exitCode = 0;
  program
    .name('harness-medic')
    .description('Evidence-first cross-harness diagnostics for coding agents')
    .version(TOOL_VERSION)
    .showSuggestionAfterError()
    .exitOverride();
  addCommonOptions(program);
  program.action(async (options: CommonCliOptions) => {
    exitCode = await runScanCommand(options);
  });

  const scan = addCommonOptions(program.command('scan').description('Run the offline effective-environment scan'));
  scan.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runScanCommand(commandOptions(options, command)); });
  const context = addCommonOptions(program.command('context').description('Show observed instruction and context budget'));
  context.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runContextCommand(commandOptions(options, command)); });
  const rules = addCommonOptions(program.command('rules').description('Diagnose effective instructions and rule health'));
  rules.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runRulesCommand(commandOptions(options, command)); });
  const mcp = addCommonOptions(program.command('mcp').description('Diagnose MCP configuration and optional probes'));
  mcp.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runMcpCommand(commandOptions(options, command)); });
  const hooks = addCommonOptions(program.command('hooks').description('Diagnose hook configuration and safe probe capability'));
  hooks.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runHooksCommand(commandOptions(options, command)); });
  const security = addCommonOptions(program.command('security').description('Diagnose local security indicators'));
  security.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runSecurityCommand(commandOptions(options, command)); });

  program.command('explain <ruleId>').description('Explain a rule contract').action((ruleId: string, _options: unknown, command: Command) => {
    exitCode = runExplainCommand(ruleId, command);
  });
  const fix = addCommonOptions(program.command('fix [ids...]').description('Preview or apply transactional fixes'));
  fix.option('--apply', 'apply after preconditions and postchecks').option('--safe', 'select only safe fixes').option('--dry-run', 'preview without writing');
  fix.action(async (ids: string[], options: CommonCliOptions, command: Command) => { exitCode = await runFixCommand(ids ?? [], commandOptions(options, command)); });
  const baseline = addCommonOptions(program.command('baseline').description('Create or compare a local redacted baseline'));
  baseline.option('--compare <path>', 'baseline snapshot to compare').option('--path <path>', 'snapshot output path');
  baseline.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runBaselineCommand(commandOptions(options, command)); });
  const benchmark = addCommonOptions(program.command('benchmark').description('Run an explicit isolated adherence benchmark'));
  benchmark.option('--pack <path>', 'benchmark pack').option('--fixture <path>', 'recorded fixture results').option('--trials <count>', 'number of trials');
  benchmark.action(async (options: CommonCliOptions, command: Command) => { exitCode = await runBenchmarkCommand(commandOptions(options, command)); });

  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    const candidate = error as { code?: string; exitCode?: number; message?: string };
    if (candidate.code === 'commander.helpDisplayed' || candidate.code === 'commander.version') return 0;
    const message = redactText(candidate.message ?? String(error));
    process.stderr.write(`${message}\n`);
    return candidate.exitCode === 1 ? 2 : 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runCli().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 2;
  });
}
