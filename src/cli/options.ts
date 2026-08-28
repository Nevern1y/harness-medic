import path from 'node:path';
import { createScanContext } from '../core/fs.js';
import { selectedHarnesses } from '../core/scan.js';
import type { Command } from 'commander';
import type { ScanContext } from '../core/model.js';

export interface CommonCliOptions {
  cwd?: string;
  home?: string;
  harness?: string;
  format?: 'terminal' | 'json';
  output?: string;
  failOn?: 'critical' | 'error' | 'warning' | 'never';
  score?: boolean;
  color?: boolean;
  verbose?: boolean;
  interactive?: boolean;
  allowServer?: string[];
  allowNetwork?: boolean;
  allowUntrusted?: boolean;
  probe?: boolean;
  timeout?: string;
  retries?: string;
  safe?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  ids?: string[];
  pack?: string;
  trials?: string;
  fixture?: string;
  compare?: string;
  path?: string;
}

export function addCommonOptions(command: Command): Command {
  return command
    .option('--cwd <path>', 'workspace path')
    .option('--home <path>', 'override harness home for fixture runs')
    .option('--harness <ids>', 'comma-separated harness IDs or all')
    .option('--format <format>', 'terminal or json')
    .option('--output <path>', 'write report atomically to a file')
    .option('--fail-on <severity>', 'critical, error, warning, or never')
    .option('--no-score', 'disable health index deductions')
    .option('--no-color', 'disable terminal color')
    .option('--verbose', 'include recoverable diagnostics on stderr')
    .option('--no-interactive', 'never prompt for consent')
    .option('--probe', 'run consent-gated MCP probes')
    .option('--allow-server <names...>', 'explicitly allow named MCP servers in non-interactive probe mode')
    .option('--allow-network', 'explicitly allow remote MCP probing')
    .option('--allow-untrusted', 'explicitly allow probing third-party or unknown-trust MCP servers')
    .option('--timeout <ms>', 'per-probe timeout')
    .option('--retries <count>', 'transient probe retries');
}

export function commandOptions(options: CommonCliOptions, command?: Command): CommonCliOptions {
  const parentOptions = command?.parent?.opts() as CommonCliOptions | undefined;
  return { ...(parentOptions ?? {}), ...options };
}

export function contextFromOptions(options: CommonCliOptions, probe = false): ScanContext {
  const base = createScanContext();
  const interactive = options.interactive !== false && Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return createScanContext({
    cwd: options.cwd ? path.resolve(options.cwd) : base.cwd,
    home: options.home ? path.resolve(options.home) : base.home,
    selectedHarnesses: selectedHarnesses(options.harness),
    scanTier: probe ? 1 : 0,
    consentPolicy: {
      ...base.consentPolicy,
      interactive,
      allowNetwork: options.allowNetwork === true,
      allowUntrusted: options.allowUntrusted === true,
      allowServers: options.allowServer ?? [],
    },
  });
}

export function numericOption(value: string | undefined, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}
