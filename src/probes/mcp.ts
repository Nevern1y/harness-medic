import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { metadataHash } from '../core/mcp/identity.js';
import { getMcpRuntimeConfig } from '../core/mcp/runtime.js';
import { redactText, redactValue } from '../core/redaction.js';
import { estimateTokenSet } from '../core/tokens.js';
import type { ActiveProbeRequest, McpServer, Observation, ScanContext, ScanServices, ToolMetadata } from '../core/model.js';
import { isTransientProbeError, retryBounded } from './supervisor.js';
import { requestMcpConsent } from './consent.js';

const execFileAsync = promisify(execFile);

type ProbePhase = 'startup' | 'tools/list';
type ProbeError = Error & { probePhase?: ProbePhase; code?: string; cleanupStatus?: Observation['cleanupStatus'] };

export async function probeMcpServer(request: ActiveProbeRequest, context: ScanContext, services: ScanServices): Promise<Observation> {
  const startedAt = services.now();
  if (request.signal?.aborted) {
    const observation: Observation = { id: `observation:${request.server.id}`, status: 'not-run', attempts: 0, evidence: [{ kind: 'cancellation', value: 'probe canceled before startup' }], cleanupStatus: 'not-applicable', errorCode: 'ABORTED' };
    request.server.observation = observation;
    return observation;
  }
  if ((request.server.transport === 'sse' || request.server.transport === 'streamable-http') && (!request.allowNetwork || !context.consentPolicy.allowNetwork)) {
    const observation: Observation = { id: `observation:${request.server.id}`, status: 'declined', attempts: 0, evidence: [{ kind: 'consent', value: 'network probing is not allowed by consent policy' }], cleanupStatus: 'not-applicable' };
    request.server.observation = observation;
    return observation;
  }
  const activeControllers = new Set<AbortController>();
  const activeAttempts = new Set<Promise<{ tools: ToolMetadata[] }>>();
  const abortActiveAttempts = (): void => {
    for (const controller of activeControllers) controller.abort();
  };
  request.signal?.addEventListener('abort', abortActiveAttempts, { once: true });
  let result: Awaited<ReturnType<typeof retryBounded<ProbeSuccess>>>;
  try {
    result = await retryBounded(async () => {
      const controller = new AbortController();
      activeControllers.add(controller);
      const attempt = probeOnce(request.server, context, request.timeoutMs, controller.signal);
      activeAttempts.add(attempt);
      try {
        return await attempt;
      } finally {
        activeAttempts.delete(attempt);
        activeControllers.delete(controller);
      }
    }, request.retries, request.timeoutMs, isTransientProbeError, abortActiveAttempts, request.signal);
  } finally {
    request.signal?.removeEventListener('abort', abortActiveAttempts);
  }
  const settledAttempts = await Promise.allSettled([...activeAttempts]);
  const activeCleanupStatus = [...settledAttempts].reverse().map((attempt) => attempt.status === 'rejected' ? cleanupStatusFromError(attempt.reason) : undefined).find((status): status is 'clean' | 'failed' => status !== undefined);
  const durationMs = Math.max(0, services.now().getTime() - startedAt.getTime());
  const error = result.error as ProbeError | undefined;
  const aborted = request.signal?.aborted === true;
  const errorCode = aborted ? 'ABORTED' : typeof error?.code === 'string' ? error.code : error?.name;
  const evidence: Observation['evidence'] = result.events.map((event) => ({ kind: event.ok ? 'attempt-success' : 'attempt-failure', value: redactText(`${event.attempt}:${event.durationMs}ms${event.errorCode ? `:${event.errorCode}` : ''}${error?.probePhase ? `:${error.probePhase}` : ''}`) }));
  if (aborted) evidence.push({ kind: 'cancellation', value: 'probe canceled' });
  const observation: Observation = {
    id: `observation:${request.server.id}`,
    status: aborted ? 'failed' : result.value ? 'observed' : result.timedOut ? 'timed-out' : 'failed',
    startedAt: startedAt.toISOString(),
    cleanupStatus: result.value?.cleanupStatus ?? error?.cleanupStatus ?? activeCleanupStatus ?? 'unknown',
    durationMs,
    attempts: result.events.length,
    evidence,
    ...(errorCode ? { errorCode: redactText(errorCode) } : {}),
  };
  request.server.observation = observation;
  if (result.value && !aborted) {
    const serialized = JSON.stringify(result.value.tools);
    request.server.toolInventory = { tools: result.value.tools, observed: true, observationId: observation.id, bytes: Buffer.byteLength(serialized, 'utf8'), tokenEstimates: estimateTokenSet(serialized) };
  }
  return observation;
}

type ProbeSuccess = { tools: ToolMetadata[]; cleanupStatus: 'clean' | 'failed' };

async function probeOnce(server: McpServer, context: ScanContext, timeoutMs: number, signal: AbortSignal): Promise<ProbeSuccess> {
  const client = new Client({ name: 'harness-medic', version: '0.1.0' });
  let phase: ProbePhase = 'startup';
  let probeError: ProbeError | undefined;
  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | undefined;
  let childPid: number | undefined;
  let tools: ToolMetadata[] = [];
  let cleanupStatus: ProbeSuccess['cleanupStatus'] = 'clean';
  try {
    transport = createTransport(server, context);
    if (transport instanceof StdioClientTransport) {
      const stdioTransport = transport;
      const start = stdioTransport.start.bind(stdioTransport);
      stdioTransport.start = async () => {
        await start();
        childPid = stdioTransport.pid ?? undefined;
      };
    }
    await client.connect(transport, { timeout: timeoutMs, signal });
    phase = 'tools/list';
    const response = await client.listTools(undefined, { timeout: timeoutMs, signal });
    tools = normalizeTools(response.tools);
  } catch (error) {
    probeError = Object.assign(error instanceof Error ? error : new Error(String(error)), { probePhase: phase });
  } finally {
    // Start tree cleanup before the SDK can kill the parent and orphan descendants.
    const processCleanup = childPid === undefined ? undefined : terminateProcessTree(childPid);
    try {
      await client.close();
    } catch {
      cleanupStatus = 'failed';
    }
    if (processCleanup && !(await processCleanup)) cleanupStatus = 'failed';
    if (probeError) probeError.cleanupStatus = cleanupStatus;
  }
  if (probeError) throw probeError;
  return { tools, cleanupStatus };

}
function cleanupStatusFromError(error: unknown): 'clean' | 'failed' | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { cleanupStatus?: unknown }).cleanupStatus;
  return value === 'clean' || value === 'failed' ? value : undefined;
}


async function terminateProcessTree(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;
  try {
    if (process.platform === 'win32') await execFileAsync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    else {
      await execFileAsync('pkill', ['-TERM', '-P', String(pid)]).catch(() => undefined);
      process.kill(pid, 'SIGTERM');
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
      if (isProcessAlive(pid)) await execFileAsync('pkill', ['-KILL', '-P', String(pid)]).catch(() => undefined);
      if (isProcessAlive(pid)) process.kill(pid, 'SIGKILL');
    }
  } catch {
    return !isProcessAlive(pid);
  }
  return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function createTransport(server: McpServer, context: ScanContext): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
  const runtime = getMcpRuntimeConfig(server);
  const requestInit = Object.keys(runtime.headers).length > 0 ? { headers: runtime.headers } : undefined;
  if (server.transport === 'stdio') {
    const command = runtime.command ?? server.command;
    if (!command) throw new Error('MCP stdio server has no command');
    return new StdioClientTransport({ command, args: runtime.args.length > 0 ? runtime.args : server.args, cwd: runtime.cwd ?? server.cwd ?? context.cwd, env: runtimeEnvironment(server), stderr: 'ignore', maxBufferSize: 1_048_576 });
  }
  const url = runtime.url ?? server.url;
  if (!url) throw new Error('MCP remote server has no URL');
  if (server.transport === 'sse') return new SSEClientTransport(new URL(url), requestInit ? { requestInit } : undefined);
  if (server.transport === 'streamable-http') return new StreamableHTTPClientTransport(new URL(url), requestInit ? { requestInit } : undefined);
  throw new Error(`Unsupported MCP transport ${server.transport}`);
}
function runtimeEnvironment(server: McpServer): Record<string, string> {
  const environment = getDefaultEnvironment();
  for (const entry of server.envKeyNames) {
    const key = entry.startsWith('${') && entry.endsWith('}') ? entry.slice(2, -1) : entry;
    if (process.env[key] !== undefined) environment[key] = process.env[key] as string;
  }
  for (const [key, value] of Object.entries(getMcpRuntimeConfig(server).environment)) if (value !== '[REDACTED]' && !value.includes('${')) environment[key] = value;
  return environment;
}
function normalizeTools(value: unknown): ToolMetadata[] {
  if (!Array.isArray(value)) throw new Error('MCP tools/list returned malformed metadata');
  const tools: ToolMetadata[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof (item as { name?: unknown }).name !== 'string') throw new Error('MCP tools/list returned a tool without a string name');
    const tool = item as { name: string; description?: unknown; inputSchema?: unknown; outputSchema?: unknown; annotations?: unknown };
    const normalized: ToolMetadata = {
      name: redactText(tool.name),
      ...(typeof tool.description === 'string' ? { description: redactValue(tool.description) as string } : {}),
      ...(tool.inputSchema !== undefined ? { inputSchema: redactValue(tool.inputSchema) } : {}),
      ...(tool.outputSchema !== undefined ? { outputSchema: redactValue(tool.outputSchema) } : {}),
      ...(tool.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations) ? { annotations: redactValue(tool.annotations) as Record<string, unknown> } : {}),
    };
    normalized.metadataHash = metadataHash(normalized);
    tools.push(normalized);
  }
  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

export async function probeApprovedServers(servers: McpServer[], context: ScanContext, services: ScanServices, timeoutMs = 10_000, retries = 1, signal?: AbortSignal): Promise<Observation[]> {
  const observations: Observation[] = [];
  for (const server of servers.filter((entry) => entry.active)) {
    if (signal?.aborted) {
      const observation: Observation = { id: `observation:${server.id}`, status: 'not-run', attempts: 0, evidence: [{ kind: 'cancellation', value: 'probe canceled before consent' }], cleanupStatus: 'not-applicable', errorCode: 'ABORTED' };
      server.observation = observation;
      observations.push(observation);
      continue;
    }
    const consent = await requestMcpConsent(server, context);
    if (!consent.approved) {
      const observation: Observation = { id: `observation:${server.id}`, status: 'declined', attempts: 0, evidence: [{ kind: 'consent', value: consent.reason }], cleanupStatus: 'not-applicable' };
      server.observation = observation;
      observations.push(observation);
      continue;
    }
    observations.push(await probeMcpServer({ server, timeoutMs, retries, allowNetwork: context.consentPolicy.allowNetwork, ...(signal ? { signal } : {}) }, context, services));
  }
  return observations;
}
