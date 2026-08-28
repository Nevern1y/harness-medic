import readline from 'node:readline/promises';
import { redactCommandArgs } from '../core/redaction.js';
import type { McpServer, ScanContext } from '../core/model.js';

export interface ConsentDecision {
  approved: boolean;
  reason: string;
}

export async function requestMcpConsent(server: McpServer, context: ScanContext): Promise<ConsentDecision> {
  const remote = server.transport === 'sse' || server.transport === 'streamable-http';
  if (remote && !context.consentPolicy.allowNetwork) return { approved: false, reason: 'network probing is not allowed by consent policy' };
  const untrusted = server.trust === 'third-party' || server.trust === 'unknown';
  if (untrusted && !context.consentPolicy.allowUntrusted && !context.consentPolicy.interactive) return { approved: false, reason: 'non-interactive probing of third-party or unknown-trust servers requires --allow-untrusted' };
  const explicitlyAllowed = context.consentPolicy.allowServers.includes(server.configuredName) || context.consentPolicy.allowServers.includes(server.id);
  if (explicitlyAllowed && (!remote || context.consentPolicy.allowNetwork) && (!untrusted || context.consentPolicy.allowUntrusted)) return { approved: true, reason: 'explicit allowlist' };
  if (!context.consentPolicy.interactive) return { approved: false, reason: 'non-interactive probe requires --allow-server and, for remote targets, --allow-network' };
  const command = server.command ? redactCommandArgs(server.command, server.args ?? []) : undefined;
  const target = server.url ?? (command ? `${command.command} ${command.args.join(' ')}`.trim() : server.canonicalIdentity);
  const io = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await io.question(`Probe ${server.configuredName} at ${target}? [y/N] `);
    const approved = /^y(?:es)?$/i.test(answer.trim());
    return { approved, reason: approved ? 'interactive consent' : 'user declined' };
  } finally {
    io.close();
  }
}
