import path from 'node:path';
import { createEnvironment, discoverDefinitions, expandInstructionDocuments, mergeMcpByName, normalizeHooks, normalizeMcpServers, normalizePermissions, parseSources, projectAndHomeInstructionDefinitions, activeSourceIds, recordUnknownFields, type SourceDefinition } from '../common.js';
import { pathExists } from '../../core/fs.js';
import { probeMcpServer } from '../../probes/mcp.js';
import type { AdapterDetection, ActiveProbeRequest, ConfigSource, EffectiveEnvironment, HarnessAdapter, ParsedSource, ProbeCapabilities } from '../../core/model.js';

const VERSION = 'codex-adapter/0.1';

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  version: VERSION,
  async detect(context, services): Promise<AdapterDetection> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const paths = [pathApi.join(context.home, '.codex'), pathApi.join(context.cwd, 'AGENTS.md'), pathApi.join(context.cwd, '.codex'), pathApi.join(context.home, '.codex', 'config.toml')];
    const evidence: string[] = [];
    for (const candidate of paths) if (await pathExists(services.fs, candidate)) evidence.push(candidate);
    return { installed: evidence.length > 0, configured: evidence.length > 0, evidence: evidence.sort() };
  },
  async discover(context, services): Promise<ConfigSource[]> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const definitions: SourceDefinition[] = [
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.codex', 'config.toml'), priority: 20, discoveredBy: 'codex:user-config', ownership: 'user' },
      { kind: 'settings', scope: 'project', path: pathApi.join(context.cwd, '.codex', 'config.toml'), priority: 50, discoveredBy: 'codex:project-config', ownership: 'workspace' },
      { kind: 'settings', scope: 'local', path: pathApi.join(context.cwd, 'codex.toml'), priority: 60, discoveredBy: 'codex:workspace-config', ownership: 'workspace' },
      ...projectAndHomeInstructionDefinitions('codex', context, ['AGENTS.md'], 30),
      { kind: 'instruction', scope: 'user', path: pathApi.join(context.home, '.codex', 'AGENTS.md'), priority: 20, discoveredBy: 'codex:user-agents', ownership: 'user' },
      { kind: 'instruction', scope: 'user', path: pathApi.join(context.home, '.codex', 'instructions.md'), priority: 21, discoveredBy: 'codex:user-instructions', ownership: 'user' },
    ];
    return discoverDefinitions('codex', definitions, context, services);
  },
  async parse(source, _context, services): Promise<ParsedSource> {
    const parsed = await parseSources([source], services);
    return parsed[0] as ParsedSource;
  },
  async resolve(parsedSources, context, services): Promise<EffectiveEnvironment> {
    const detection = await this.detect(context, services);
    const environment = createEnvironment('codex', VERSION, context, parsedSources.map((parsed) => parsed.source), detection.installed);
    const expandedInstructions = await expandInstructionDocuments(parsedSources, context, services);
    environment.instructions = expandedInstructions.documents;
    environment.sources.push(...expandedInstructions.sources);
    const mcpEntries: Array<{ source: ConfigSource; servers: Awaited<ReturnType<typeof normalizeMcpServers>> }> = [];
    for (const parsed of parsedSources) {
      if (parsed.source.parseStatus !== 'parsed' || parsed.source.kind !== 'settings') continue;
      mcpEntries.push({ source: parsed.source, servers: await normalizeMcpServers(parsed.value, parsed.source, context, services) });
      environment.hooks.push(...await normalizeHooks(parsed.value, parsed.source, services, context.cwd));
      environment.permissions.push(...normalizePermissions(parsed.value, parsed.source));
      const value = parsed.value as Record<string, unknown>;
      recordUnknownFields(environment, parsed.source, value, ['mcp_servers', 'mcpServers', 'hooks', 'permissions', 'model', 'approval_policy', 'sandbox_mode']);
    }
    await mergeMcpByName(mcpEntries, environment);
    activeSourceIds(environment);
    return environment;
  },
  probeCapabilities(): ProbeCapabilities {
    return { mcpList: 'supported', hookSynthetic: 'unsupported', transcripts: 'unsupported', compactionBenchmark: 'unsupported', subagents: 'supported' };
  },
  async activeProbe(request: ActiveProbeRequest, context, services) {
    return probeMcpServer(request, context, services);
  }
};
