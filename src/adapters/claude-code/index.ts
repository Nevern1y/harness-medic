import path from 'node:path';
import { createEnvironment, discoverDefinitions, expandInstructionDocuments, mergeMcpByName, normalizeHooks, normalizeMcpServers, normalizePermissions, parseSources, projectAndHomeInstructionDefinitions, activeSourceIds, recordUnknownFields, type SourceDefinition } from '../common.js';
import { pathExists } from '../../core/fs.js';
import { probeMcpServer } from '../../probes/mcp.js';
import type { AdapterDetection, ActiveProbeRequest, ConfigSource, EffectiveEnvironment, HarnessAdapter, ParsedSource, ProbeCapabilities } from '../../core/model.js';

const VERSION = 'claude-code-adapter/0.1';

export const claudeCodeAdapter: HarnessAdapter = {
  id: 'claude-code',
  version: VERSION,
  async detect(context, services): Promise<AdapterDetection> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const paths = [pathApi.join(context.home, '.claude'), pathApi.join(context.home, '.claude.json'), pathApi.join(context.cwd, '.claude'), pathApi.join(context.cwd, '.mcp.json')];
    const evidence: string[] = [];
    for (const candidate of paths) if (await pathExists(services.fs, candidate)) evidence.push(candidate);
    return { installed: evidence.length > 0, configured: evidence.length > 0, evidence: evidence.sort() };
  },
  async discover(context, services): Promise<ConfigSource[]> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const definitions: SourceDefinition[] = [
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.claude', 'settings.json'), priority: 20, discoveredBy: 'claude:user-settings', ownership: 'user' },
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.claude', 'settings.local.json'), priority: 25, discoveredBy: 'claude:user-local-settings', ownership: 'user' },
      { kind: 'settings', scope: 'managed', path: pathApi.join(context.home, '.claude', 'managed-settings.json'), priority: 90, discoveredBy: 'claude:managed-settings', ownership: 'managed' },
      { kind: 'settings', scope: 'project', path: pathApi.join(context.cwd, '.claude', 'settings.json'), priority: 50, discoveredBy: 'claude:project-settings', ownership: 'workspace' },
      { kind: 'settings', scope: 'local', path: pathApi.join(context.cwd, '.claude', 'settings.local.json'), priority: 60, discoveredBy: 'claude:local-settings', ownership: 'workspace' },
      { kind: 'mcp', scope: 'user', path: pathApi.join(context.home, '.claude.json'), priority: 20, discoveredBy: 'claude:user-mcp', ownership: 'user' },
      { kind: 'mcp', scope: 'project', path: pathApi.join(context.cwd, '.claude.json'), priority: 45, discoveredBy: 'claude:project-mcp', ownership: 'workspace' },
      { kind: 'mcp', scope: 'project', path: pathApi.join(context.cwd, '.mcp.json'), priority: 55, discoveredBy: 'claude:project-mcp-file', ownership: 'workspace' },
      ...projectAndHomeInstructionDefinitions('claude-code', context, ['CLAUDE.md', '.claude/CLAUDE.md'], 30),
      { kind: 'instruction', scope: 'user', path: pathApi.join(context.home, '.claude', 'CLAUDE.md'), priority: 20, discoveredBy: 'claude:user-instruction', ownership: 'user' },
    ];
    return discoverDefinitions('claude-code', definitions, context, services);
  },
  async parse(source, _context, services): Promise<ParsedSource> {
    const parsed = await parseSources([source], services);
    return parsed[0] as ParsedSource;
  },
  async resolve(parsedSources, context, services): Promise<EffectiveEnvironment> {
    const detection = await this.detect(context, services);
    const environment = createEnvironment('claude-code', VERSION, context, parsedSources.map((parsed) => parsed.source), detection.installed);
    const expandedInstructions = await expandInstructionDocuments(parsedSources, context, services);
    environment.instructions = expandedInstructions.documents;
    environment.sources.push(...expandedInstructions.sources);
    const mcpEntries: Array<{ source: ConfigSource; servers: Awaited<ReturnType<typeof normalizeMcpServers>> }> = [];
    for (const parsed of parsedSources) {
      if (parsed.source.parseStatus !== 'parsed') continue;
      if (parsed.source.kind === 'settings' || parsed.source.kind === 'mcp') {
        mcpEntries.push({ source: parsed.source, servers: await normalizeMcpServers(parsed.value, parsed.source, context, services) });
        environment.hooks.push(...await normalizeHooks(parsed.value, parsed.source, services, context.cwd));
        environment.permissions.push(...normalizePermissions(parsed.value, parsed.source));
        const value = parsed.value as Record<string, unknown>;
        recordUnknownFields(environment, parsed.source, value, ['mcpServers', 'hooks', 'permissions', 'env', 'model', 'enabledPlugins']);
      }
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
