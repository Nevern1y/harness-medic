import path from 'node:path';
import { redactCommandArgs, redactRecord, redactText, redactValue } from '../core/redaction.js';
import { ancestorDirectories, normalizePathForIdentity, pathExists, resolvePathFrom, safeRealpath, sha256 } from '../core/fs.js';
import { buildInstructionDocument } from '../core/instructions.js';
import { estimateTokenSet } from '../core/tokens.js';
import { metadataHash } from '../core/mcp/identity.js';
import { setMcpRuntimeConfig } from '../core/mcp/runtime.js';
import { parseSourceFile, parserForPath } from '../parsers/index.js';
import type {
  ConfigSource,
  EffectiveEnvironment,
  HookKind,
  HookRegistration,
  HarnessId,
  InstructionDocument,
  McpServer,
  ParsedSource,
  PermissionRule,
  ScanContext,
  ScanServices,
  SourceKind,
  SourceLocation,
  SourceScope,
  ToolInventory,
  ToolMetadata,
  TransportKind,
} from '../core/model.js';

export interface SourceDefinition {
  kind: SourceKind;
  scope: SourceScope;
  path: string;
  priority: number;
  discoveredBy: string;
  ownership: ConfigSource['ownership'];
}

export async function discoverDefinitions(harness: HarnessId, definitions: SourceDefinition[], context: ScanContext, services: ScanServices): Promise<ConfigSource[]> {
  const sources: ConfigSource[] = [];
  const seen = new Set<string>();
  const pathApi = services.isWindows ? path.win32 : path.posix;
  for (const definition of definitions) {
    const lexicalPath = pathApi.normalize(definition.path);
    const identity = `${harness}:${definition.kind}:${normalizePathForIdentity(lexicalPath, services.isWindows)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (!(await pathExists(services.fs, lexicalPath))) continue;
    const realPath = await safeRealpath(services.fs, lexicalPath);
    const source: ConfigSource = {
      id: `${harness}:${sha256(identity).slice(0, 16)}`,
      harness,
      kind: definition.kind,
      scope: definition.scope,
      path: lexicalPath,
      priority: definition.priority,
      applicable: definition.scope === 'user' || definition.scope === 'managed' || definition.scope === 'plugin' || definition.scope === 'runtime' ? true : isPathApplicable(lexicalPath, context.cwd, services.isWindows),
      ownership: definition.ownership,
      parser: parserForPath(lexicalPath, definition.kind),
      parseStatus: 'unavailable',
      diagnostics: [],
      discoveredBy: definition.discoveredBy,
      lexicalPath,
      ...(realPath ? { realPath } : {}),
    };
    sources.push(source);
  }
  return sources.sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path));
}

export async function parseSources(sources: ConfigSource[], services: ScanServices): Promise<ParsedSource[]> {
  const parsed: ParsedSource[] = [];
  for (const source of sources) {
    const result = await parseSourceFile(services.fs, source);
    for (const diagnostic of result.source.diagnostics) {
      if (diagnostic.location?.path === '<source>') diagnostic.location.path = source.path;
    }
    parsed.push(result);
  }
  return parsed;
}

export function sourceLocation(source: ConfigSource, line = 1): SourceLocation {
  return { path: source.path, line, column: 0 };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function createEnvironment(harness: HarnessId, version: string, context: ScanContext, sources: ConfigSource[], detected: boolean): EffectiveEnvironment {
  const gaps = defaultCoverageGaps(harness);
  return {
    harness,
    adapterVersion: version,
    workspace: context.cwd,
    detected,
    sources,
    activeSourceIds: sources.filter((source) => source.parseStatus === 'parsed' && source.applicable).map((source) => source.id),
    shadowEdges: [],
    coverageGaps: gaps,
    instructions: [],
    mcpServers: [],
    tools: [],
    hooks: [],
    subagents: [],
    permissions: [],
    unknownFields: {},
  };
}

function defaultCoverageGaps(harness: HarnessId) {
  return [
    {
      id: `${harness}-managed-policy`,
      area: 'managed-policy',
      reason: 'Managed or administrator-delivered policy may not be readable from the local workspace.',
      impact: 'high' as const,
      source: 'adapter coverage contract',
    },
    {
      id: `${harness}-runtime-context`,
      area: 'runtime-context',
      reason: 'System prompt, plugin injection, and session state are not observable in Tier 0.',
      impact: 'medium' as const,
      source: 'offline scan boundary',
    },
  ];
}
export function instructionDocuments(parsedSources: ParsedSource[]): InstructionDocument[] {
  return parsedSources
    .filter((parsed) => parsed.source.kind === 'instruction' && parsed.source.parseStatus === 'parsed')
    .map((parsed) => buildInstructionDocument(parsed.source, parsed.content))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function expandInstructionDocuments(parsedSources: ParsedSource[], context: ScanContext, services: ScanServices): Promise<{ documents: InstructionDocument[]; sources: ConfigSource[] }> {
  const documents = instructionDocuments(parsedSources);
  const sources: ConfigSource[] = [];
  const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
  const byPath = new Map(documents.map((document) => [normalizePathForIdentity(document.path, context.platform === 'win32'), document]));
  const queue = documents.map((document) => ({ document, ancestry: [normalizePathForIdentity(document.path, context.platform === 'win32')] }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const parentSource = parsedSources.find((parsed) => parsed.source.id === current.document.sourceId)?.source ?? sources.find((source) => source.id === current.document.sourceId);
    if (!parentSource) continue;
    for (const importName of current.document.imports) {
      const importPath = pathApi.normalize(resolvePathFrom(pathApi.dirname(parentSource.path), importName, context.platform === 'win32'));
      const importIdentity = normalizePathForIdentity(importPath, context.platform === 'win32');
      if (current.ancestry.includes(importIdentity)) {
        for (const identity of [...current.ancestry, importIdentity]) {
          const cycleDocument = byPath.get(identity);
          const cycleSource = cycleDocument ? parsedSources.find((parsed) => parsed.source.id === cycleDocument.sourceId)?.source ?? sources.find((source) => source.id === cycleDocument.sourceId) : undefined;
          if (!cycleSource || cycleSource.parseStatus === 'invalid') continue;
          cycleSource.parseStatus = 'invalid';
          cycleSource.diagnostics.push({ code: 'IMPORT_CYCLE', message: `Instruction import cycle includes ${importPath}`, severity: 'error', location: { path: cycleSource.path } });
        }
        continue;
      }
      if (byPath.has(importIdentity)) continue;
      const realPath = await safeRealpath(services.fs, importPath);
      const importedSource: ConfigSource = {
        id: `${parentSource.id}:import:${sha256(importPath).slice(0, 12)}`,
        harness: parentSource.harness,
        kind: 'instruction',
        scope: parentSource.scope,
        path: importPath,
        priority: parentSource.priority,
        applicable: parentSource.applicable,
        ownership: parentSource.ownership,
        parser: 'markdown',
        parseStatus: 'unavailable',
        diagnostics: [],
        discoveredBy: `${parentSource.discoveredBy}:import`,
        lexicalPath: importPath,
        ...(realPath ? { realPath } : {}),
      };
      const parsed = await parseSourceFile(services.fs, importedSource);
      for (const diagnostic of parsed.source.diagnostics) if (diagnostic.location?.path === '<source>') diagnostic.location.path = importPath;
      sources.push(importedSource);
      if (importedSource.parseStatus !== 'parsed') {
        parentSource.parseStatus = 'invalid';
        parentSource.diagnostics.push({ code: 'IMPORT_FAILED', message: `Instruction import ${importPath} could not be loaded`, severity: 'error', location: { path: importPath } });
        continue;
      }
      const document = buildInstructionDocument(importedSource, parsed.content, 'imported');
      document.active = current.document.active;
      documents.push(document);
      byPath.set(importIdentity, document);
      queue.push({ document, ancestry: [...current.ancestry, importIdentity] });
    }
  }
  return { documents: documents.sort((left, right) => left.path.localeCompare(right.path)), sources };
}

export function normalizeMcpServers(value: unknown, source: ConfigSource, context: ScanContext, services: ScanServices): Promise<McpServer[]> {
  const record = asRecord(value);
  const candidates = isRecord(record.mcpServers) ? record.mcpServers : isRecord(record.mcp) ? record.mcp : isRecord(record.mcp_servers) ? record.mcp_servers : {};
  const output: Array<Promise<McpServer | undefined>> = [];
  for (const [configuredName, config] of Object.entries(candidates)) output.push(normalizeOneMcp(configuredName, config, source, context, services));
  return Promise.all(output).then((servers) => servers.filter((server): server is McpServer => Boolean(server)));
}

async function normalizeOneMcp(configuredName: string, config: unknown, source: ConfigSource, context: ScanContext, services: ScanServices): Promise<McpServer | undefined> {
  if (!isRecord(config)) return undefined;
  const commandValue = config.command;
  const commandArray = Array.isArray(commandValue) ? commandValue.filter((entry): entry is string => typeof entry === 'string') : [];
  const command = typeof commandValue === 'string' ? commandValue : commandArray[0];
  const args = Array.isArray(commandValue) ? commandArray.slice(1) : Array.isArray(config.args) ? config.args.filter((entry): entry is string => typeof entry === 'string') : [];
  const url = stringValue(config.url) ?? stringValue(config.endpoint);
  const transport = transportFor(config, command, url);
  const configuredCwd = stringValue(config.cwd);
  const resolvedCwd = configuredCwd ? resolvePathFrom(context.cwd, configuredCwd, context.platform === 'win32') : context.cwd;
  const configuredEnvironment = {
    ...(isRecord(config.env) ? config.env : {}),
    ...(isRecord(config.environment) ? config.environment : {}),
  };
  const runtimeEnvironment = Object.fromEntries(Object.entries(configuredEnvironment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const runtimeHeaders = Object.fromEntries(Object.entries(isRecord(config.headers) ? config.headers : {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const envReferences = environmentReferences(config).map((name) => `\${${name}}`);
  const envKeyNames = [...new Set([...Object.keys(configuredEnvironment), ...envReferences])].map(redactText).sort();
  const headerKeyNames = Object.keys(runtimeHeaders).map(redactText).sort();
  const envFingerprint = envKeyNames.length > 0 ? sha256(envKeyNames.join('\n')) : undefined;
  const canonicalIdentity = await canonicalMcpIdentity({ command, args, url, transport, cwd: resolvedCwd, envKeyNames, headerKeyNames, envFingerprint }, services);
  const display = redactCommandArgs(command ?? '', args);
  const enabled = config.enabled !== false && config.disabled !== true;
  const trust = trustForSource(source);
  const toolInventory = staticToolInventory(config.tools);
  const metadata = redactMcpMetadata(config);
  const id = `${source.id}:mcp:${sha256(`${configuredName}:${canonicalIdentity}`).slice(0, 12)}`;
  const server: McpServer = {
    id,
    sourceId: source.id,
    configuredName: redactText(configuredName),
    canonicalIdentity,
    transport,
    ...(display.command ? { command: display.command } : {}),
    ...(display.args.length > 0 ? { args: display.args } : {}),
    ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
    ...(url ? { url: redactUrl(url) } : {}),
    envKeyNames,
    ...(envFingerprint ? { envFingerprint } : {}),
    enabled,
    active: enabled && source.applicable && transport !== 'unknown',
    trust,
    ...(toolInventory ? { toolInventory } : {}),
    configLocation: sourceLocation(source),
    rawMetadata: metadata,
  };
  setMcpRuntimeConfig(server, { command, args, cwd: resolvedCwd, url, environment: runtimeEnvironment, headers: runtimeHeaders });
  return server;

}
function environmentReferences(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g)) if (match[1] && match[1] !== 'workspaceFolder' && match[1] !== 'userHome' && match[1] !== 'workspaceFolderBasename' && match[1] !== 'pathSeparator') found.add(match[1]);
      return;
    }
    if (Array.isArray(current)) for (const item of current) visit(item);
    else if (isRecord(current)) for (const item of Object.values(current)) visit(item);
  };
  visit(value);
  return [...found];
}
function redactMcpMetadata(config: Record<string, unknown>): Record<string, unknown> {
  const metadata = redactRecord(config);
  for (const key of ['env', 'environment', 'headers']) {
    const value = config[key];
    if (!isRecord(value)) continue;
    metadata[key] = Object.fromEntries(Object.keys(value).sort().map((name) => [redactText(name), '[REDACTED]']));
  }
  return metadata;
}
export function recordUnknownFields(environment: EffectiveEnvironment, source: ConfigSource, value: Record<string, unknown>, knownKeys: readonly string[]): void {
  for (const [key, fieldValue] of Object.entries(value)) {
    if (knownKeys.includes(key)) continue;
    environment.unknownFields[`source:${source.id}:${redactText(key)}`] = redactValue(fieldValue);
  }
}

function transportFor(config: Record<string, unknown>, command: string | undefined, url: string | undefined): TransportKind {
  const declared = stringValue(config.type)?.toLowerCase();
  if (declared === 'sse') return 'sse';
  if (declared === 'streamable-http' || declared === 'http' || declared === 'https') return 'streamable-http';
  if (url) return 'streamable-http';
  if (command) return 'stdio';
  return 'unknown';
}

async function canonicalMcpIdentity(input: { command?: string; args: string[]; url?: string; transport: TransportKind; cwd: string; envKeyNames: string[]; headerKeyNames: string[]; envFingerprint?: string }, services: ScanServices): Promise<string> {
  if (input.url) {
    let normalizedUrl: string;
    try {
      const parsed = new URL(input.url);
      parsed.username = '';
      parsed.password = '';
      parsed.searchParams.sort();
      for (const key of [...parsed.searchParams.keys()]) if (/token|secret|key|auth|signature|credential/i.test(key)) parsed.searchParams.set(key, '[REDACTED]');
      if (parsed.hash) parsed.hash = '#[REDACTED]';
      normalizedUrl = parsed.toString();
    } catch {
      normalizedUrl = redactText(input.url.trim());
    }
    return `remote|${input.transport}|${normalizedUrl}|env:${input.envKeyNames.join(',')}|headers:${input.headerKeyNames.join(',')}`;
  }
  const resolved = input.command ? await services.resolveExecutable(input.command, input.cwd) : undefined;
  const command = normalizePathForIdentity(resolved ?? input.command ?? '', services.isWindows);
  const args = redactCommandArgs('', input.args).args;
  return `stdio|${command}|args:${args.join('\u001f')}|cwd:${normalizePathForIdentity(input.cwd, services.isWindows)}|env:${input.envKeyNames.join(',')}|fingerprint:${input.envFingerprint ?? ''}`;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|key|auth|signature|credential/i.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    if (parsed.hash) parsed.hash = '#[REDACTED]';
    return redactText(parsed.toString());
  } catch {
    return redactText(value);
  }
}

function trustForSource(source: ConfigSource): McpServer['trust'] {
  if (source.scope === 'managed') return 'managed';
  if (source.scope === 'user') return 'user';
  if (source.scope === 'project' || source.scope === 'local' || source.scope === 'workspace') return 'workspace';
  if (source.scope === 'plugin') return 'third-party';
  return 'unknown';
}

function staticToolInventory(value: unknown): ToolInventory | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string') return [];
    const normalized: ToolMetadata = {
      name: redactText(entry.name),
      ...(typeof entry.description === 'string' ? { description: redactText(entry.description) } : {}),
      ...(entry.inputSchema !== undefined ? { inputSchema: redactValue(entry.inputSchema) } : {}),
      ...(entry.outputSchema !== undefined ? { outputSchema: redactValue(entry.outputSchema) } : {}),
      ...(isRecord(entry.annotations) ? { annotations: redactValue(entry.annotations) as Record<string, unknown> } : {}),
    };
    normalized.metadataHash = metadataHash(normalized);
    return [normalized];
  });
  const serialized = JSON.stringify(tools);
  return { tools, observed: false, bytes: Buffer.byteLength(serialized, 'utf8'), tokenEstimates: estimateTokenSet(serialized) };
}

export async function mergeMcpByName(entries: Array<{ source: ConfigSource; servers: McpServer[] }>, environment: EffectiveEnvironment): Promise<void> {
  const winners = new Map<string, McpServer>();
  const sorted = [...entries].sort((left, right) => left.source.priority - right.source.priority || left.source.path.localeCompare(right.source.path));
  for (const entry of sorted) {
    if (!entry.source.applicable) continue;
    for (const server of entry.servers) {
      const previous = winners.get(server.configuredName);
      if (previous) {
        previous.active = false;
        environment.shadowEdges.push({ fromSourceId: previous.sourceId, toSourceId: server.sourceId, reason: 'same configured name loses to higher-precedence registration', subject: server.configuredName });
      }
      if (server.enabled) winners.set(server.configuredName, server);
    }
  }
 environment.mcpServers = sorted.filter((entry) => entry.source.applicable).flatMap((entry) => entry.servers);
  environment.mcpServers.sort((left, right) => left.configuredName.localeCompare(right.configuredName) || left.sourceId.localeCompare(right.sourceId));
  environment.tools = environment.mcpServers.filter((server) => server.active).flatMap((server) => server.toolInventory?.tools ?? []);
}

export async function normalizeHooks(value: unknown, source: ConfigSource, services: ScanServices, workingDirectory = (services.isWindows ? path.win32 : path.posix).dirname(source.path)): Promise<HookRegistration[]> {
  const root = asRecord(value);
  const hooksRoot = isRecord(root.hooks) ? root.hooks : {};
  const output: HookRegistration[] = [];
  for (const [event, registrations] of Object.entries(hooksRoot)) {
    const list = flattenHookRegistrations(registrations);
    for (const [index, item] of list.entries()) {
      const matcher = stringValue(item.matcher) ?? stringValue(item.match);
      const command = stringValue(item.command) ?? stringValue(item.target) ?? stringValue(item.prompt) ?? stringValue(item.agent) ?? '';
      const declaredType = stringValue(item.type)?.toLowerCase();
      const kind: HookKind = declaredType === 'prompt' || typeof item.prompt === 'string' ? 'prompt' : declaredType === 'agent' || typeof item.agent === 'string' ? 'agent' : command.length > 0 ? 'command' : 'unknown';
      const firstCommand = firstShellWord(command);
      const resolvedTarget = kind === 'command' && firstCommand.length > 0 ? await services.resolveExecutable(firstCommand, workingDirectory) : undefined;
      const validation = validateHook(event, matcher, command, item.timeout);
      output.push({
        id: `${source.id}:hook:${index}`,
        sourceId: source.id,
        event: redactText(event),
        ...(matcher ? { matcher: redactText(matcher) } : {}),
        kind,
        target: redactText(command),
        ...(resolvedTarget ? { resolvedTarget } : {}),
        ...(typeof item.timeout === 'number' ? { timeout: item.timeout } : {}),
        active: source.applicable,
        validation,
        location: sourceLocation(source),
      });
    }
  }
  return output;
}

function flattenHookRegistrations(value: unknown, inheritedMatcher?: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((entry) => flattenHookRegistrations(entry, inheritedMatcher));
  if (!isRecord(value)) return [{ command: value, ...(inheritedMatcher ? { matcher: inheritedMatcher } : {}) }];
  const matcher = stringValue(value.matcher) ?? stringValue(value.match) ?? inheritedMatcher;
  if (Array.isArray(value.hooks)) return value.hooks.flatMap((entry) => flattenHookRegistrations(entry, matcher));
  return [{ ...value, ...(matcher && value.matcher === undefined && value.match === undefined ? { matcher } : {}) }];
}

function firstShellWord(command: string): string {
  const match = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function validateHook(event: string, matcher: string | undefined, target: string, timeout: unknown) {
  const validEvents = /^(PreToolUse|PostToolUse|PostToolUseFailure|Notification|Stop|StopFailure|SubagentStart|SubagentStop|TeammateIdle|TaskCompleted|SessionStart|SessionEnd|UserPromptSubmit|PreCompact|PermissionRequest|Setup|ConfigChange)$/;
  const eventValid = validEvents.test(event);
  const validation: HookRegistration['validation'] = [{ code: 'event', valid: eventValid, message: eventValid ? 'event is recognized' : 'event is not recognized by the supported static schema' }];
  if (matcher !== undefined) validation.push({ code: 'matcher', valid: matcher.length > 0 && matcher.length <= 500, message: matcher.length > 0 && matcher.length <= 500 ? 'matcher has a bounded string shape' : 'matcher is empty or exceeds the supported bound' });
  if (target.length === 0) validation.push({ code: 'target', valid: false, message: 'hook has no executable or prompt target' });
  if (timeout !== undefined) validation.push({ code: 'timeout', valid: typeof timeout === 'number' && timeout > 0, message: typeof timeout === 'number' && timeout > 0 ? 'timeout is positive' : 'timeout must be a positive number' });
  return validation;
}
export function normalizePermissions(value: unknown, source: ConfigSource): PermissionRule[] {
  const root = asRecord(value);
  const permissions = isRecord(root.permissions) ? root.permissions : isRecord(root.permission) ? root.permission : {};
  const output: PermissionRule[] = [];
  const modeNames = ['allow', 'deny', 'ask'] as const;
  for (const modeName of modeNames) {
    const entries = permissions[modeName];
    const list = Array.isArray(entries) ? entries : typeof entries === 'string' ? [entries] : [];
    for (const [index, entry] of list.entries()) if (typeof entry === 'string') output.push({ id: `${source.id}:permission:${modeName}:${index}`, sourceId: source.id, action: redactText(entry), pattern: redactText(entry), mode: modeName, active: source.applicable });
  }
  for (const [action, modeValue] of Object.entries(permissions)) {
    if (modeNames.includes(action as (typeof modeNames)[number])) continue;
    const modeText = typeof modeValue === 'string' ? modeValue.toLowerCase() : isRecord(modeValue) && typeof modeValue.mode === 'string' ? modeValue.mode.toLowerCase() : 'unknown';
    const mode: PermissionRule['mode'] = modeText === 'allow' || modeText === 'deny' || modeText === 'ask' ? modeText : 'unknown';
    const pattern = isRecord(modeValue) && typeof modeValue.pattern === 'string' ? modeValue.pattern : undefined;
    output.push({ id: `${source.id}:permission:${action}`, sourceId: source.id, action: redactText(action), ...(pattern ? { pattern: redactText(pattern) } : {}), mode, active: source.applicable });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

export function projectAndHomeInstructionDefinitions(harness: HarnessId, context: ScanContext, rootNames: string[], priorityBase = 30): SourceDefinition[] {
  const definitions: SourceDefinition[] = [];
  const isWindows = context.platform === 'win32';
  const pathApi = isWindows ? path.win32 : path.posix;
  const ancestors = ancestorDirectories(context.cwd, isWindows);
  for (const [index, directory] of ancestors.entries()) {
    for (const name of rootNames) {
      definitions.push({ kind: 'instruction', scope: directory === context.cwd ? 'local' : 'project', path: pathApi.join(directory, name), priority: priorityBase + index, discoveredBy: `${harness}:ancestor-instruction`, ownership: 'workspace' });
    }
  }
  return definitions;
}

export function addUserInstructionDefinitions(definitions: SourceDefinition[], home: string, names: string[], priority = 20): void {
  for (const name of names) definitions.push({ kind: 'instruction', scope: 'user', path: path.join(home, name), priority, discoveredBy: 'user-instruction', ownership: 'user' });
}

export function activeSourceIds(environment: EffectiveEnvironment): void {
  environment.activeSourceIds = environment.sources.filter((source) => source.parseStatus === 'parsed' && source.applicable).map((source) => source.id).sort();
  for (const instruction of environment.instructions) {
    const source = environment.sources.find((candidate) => candidate.id === instruction.sourceId);
    instruction.active = source?.parseStatus === 'parsed' && source.applicable;
  }
}

function isPathApplicable(filePath: string, cwd: string, isWindows: boolean): boolean {
  const pathApi = isWindows ? path.win32 : path.posix;
  const normalizedPath = pathApi.resolve(filePath);
  const normalizedCwd = pathApi.resolve(cwd);
  return normalizedPath === normalizedCwd || normalizedPath.startsWith(`${normalizedCwd}${pathApi.sep}`) || !filePath.includes(`${pathApi.sep}.`);
}
