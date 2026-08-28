import path from 'node:path';
import { createEnvironment, discoverDefinitions, expandInstructionDocuments, mergeMcpByName, normalizeHooks, normalizeMcpServers, normalizePermissions, parseSources, projectAndHomeInstructionDefinitions, activeSourceIds, recordUnknownFields, type SourceDefinition } from '../common.js';
import { pathExists } from '../../core/fs.js';
import { probeMcpServer } from '../../probes/mcp.js';
import type { AdapterDetection, ActiveProbeRequest, ConfigSource, EffectiveEnvironment, HarnessAdapter, ParsedSource, ProbeCapabilities } from '../../core/model.js';

const VERSION = 'opencode-adapter/0.1';

export const opencodeAdapter: HarnessAdapter = {
  id: 'opencode',
  version: VERSION,
  async detect(context, services): Promise<AdapterDetection> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const paths = [pathApi.join(context.home, '.config', 'opencode'), pathApi.join(context.home, '.opencode'), pathApi.join(context.cwd, 'opencode.json'), pathApi.join(context.cwd, '.opencode')];
    const evidence: string[] = [];
    for (const candidate of paths) if (await pathExists(services.fs, candidate)) evidence.push(candidate);
    return { installed: evidence.length > 0, configured: evidence.length > 0, evidence: evidence.sort() };
  },
  async discover(context, services): Promise<ConfigSource[]> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const definitions: SourceDefinition[] = [
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.config', 'opencode', 'opencode.json'), priority: 20, discoveredBy: 'opencode:user-config', ownership: 'user' },
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.config', 'opencode', 'opencode.jsonc'), priority: 21, discoveredBy: 'opencode:user-config-jsonc', ownership: 'user' },
      { kind: 'settings', scope: 'user', path: pathApi.join(context.home, '.opencode', 'opencode.json'), priority: 22, discoveredBy: 'opencode:user-config-legacy', ownership: 'user' },
      { kind: 'settings', scope: 'project', path: pathApi.join(context.cwd, 'opencode.json'), priority: 50, discoveredBy: 'opencode:project-config', ownership: 'workspace' },
      { kind: 'settings', scope: 'project', path: pathApi.join(context.cwd, 'opencode.jsonc'), priority: 51, discoveredBy: 'opencode:project-config-jsonc', ownership: 'workspace' },
      { kind: 'settings', scope: 'local', path: pathApi.join(context.cwd, '.opencode', 'opencode.json'), priority: 60, discoveredBy: 'opencode:local-config', ownership: 'workspace' },
      ...projectAndHomeInstructionDefinitions('opencode', context, ['AGENTS.md', 'CLAUDE.md'], 30),
    ];
    const rules = await services.fs.glob(['.opencode/rules/**/*.md', '.opencode/rules/**/*.mdc'], context.cwd);
    for (const rulePath of rules) definitions.push({ kind: 'instruction', scope: 'local', path: rulePath, priority: 65, discoveredBy: 'opencode:rules-directory', ownership: 'workspace' });
    return discoverDefinitions('opencode', definitions, context, services);
  },
  async parse(source, _context, services): Promise<ParsedSource> {
    const parsed = await parseSources([source], services);
    return parsed[0] as ParsedSource;
  },
  async resolve(parsedSources, context, services): Promise<EffectiveEnvironment> {
    const detection = await this.detect(context, services);
    const environment = createEnvironment('opencode', VERSION, context, parsedSources.map((parsed) => parsed.source), detection.installed);
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
      recordUnknownFields(environment, parsed.source, value, ['mcp', 'mcpServers', 'permission', 'permissions', 'agent', 'provider', 'command', 'plugin']);
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
