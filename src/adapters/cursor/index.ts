import path from 'node:path';
import { createEnvironment, discoverDefinitions, expandInstructionDocuments, mergeMcpByName, normalizeHooks, normalizeMcpServers, normalizePermissions, parseSources, projectAndHomeInstructionDefinitions, activeSourceIds, recordUnknownFields, type SourceDefinition } from '../common.js';
import { pathExists } from '../../core/fs.js';
import { probeMcpServer } from '../../probes/mcp.js';
import type { AdapterDetection, ActiveProbeRequest, ConfigSource, EffectiveEnvironment, HarnessAdapter, ParsedSource, ProbeCapabilities } from '../../core/model.js';

const VERSION = 'cursor-adapter/0.1';

export const cursorAdapter: HarnessAdapter = {
  id: 'cursor',
  version: VERSION,
  async detect(context, services): Promise<AdapterDetection> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const paths = [pathApi.join(context.home, '.cursor'), pathApi.join(context.cwd, '.cursor'), pathApi.join(context.cwd, '.cursor', 'mcp.json')];
    const evidence: string[] = [];
    for (const candidate of paths) if (await pathExists(services.fs, candidate)) evidence.push(candidate);
    return { installed: evidence.length > 0, configured: evidence.length > 0, evidence: evidence.sort() };
  },
  async discover(context, services): Promise<ConfigSource[]> {
    const pathApi = context.platform === 'win32' ? path.win32 : path.posix;
    const definitions: SourceDefinition[] = [
      { kind: 'mcp', scope: 'user', path: pathApi.join(context.home, '.cursor', 'mcp.json'), priority: 20, discoveredBy: 'cursor:user-mcp', ownership: 'user' },
      { kind: 'mcp', scope: 'project', path: pathApi.join(context.cwd, '.cursor', 'mcp.json'), priority: 50, discoveredBy: 'cursor:project-mcp', ownership: 'workspace' },
      ...projectAndHomeInstructionDefinitions('cursor', context, ['AGENTS.md'], 30),
    ];
    const rules = await services.fs.glob(['.cursor/rules/**/*.md', '.cursor/rules/**/*.mdc'], context.cwd);
    for (const rulePath of rules) definitions.push({ kind: 'instruction', scope: 'local', path: rulePath, priority: 65, discoveredBy: 'cursor:rules-directory', ownership: 'workspace' });
    return discoverDefinitions('cursor', definitions, context, services);
  },
  async parse(source, _context, services): Promise<ParsedSource> {
    const parsed = await parseSources([source], services);
    return parsed[0] as ParsedSource;
  },
  async resolve(parsedSources, context, services): Promise<EffectiveEnvironment> {
    const detection = await this.detect(context, services);
    const environment = createEnvironment('cursor', VERSION, context, parsedSources.map((parsed) => parsed.source), detection.installed);
    const expandedInstructions = await expandInstructionDocuments(parsedSources, context, services);
    environment.instructions = expandedInstructions.documents;
    environment.sources.push(...expandedInstructions.sources);
    const mcpEntries: Array<{ source: ConfigSource; servers: Awaited<ReturnType<typeof normalizeMcpServers>> }> = [];
    for (const parsed of parsedSources) {
      if (parsed.source.parseStatus !== 'parsed' || parsed.source.kind !== 'mcp') continue;
      mcpEntries.push({ source: parsed.source, servers: await normalizeMcpServers(parsed.value, parsed.source, context, services) });
      environment.hooks.push(...await normalizeHooks(parsed.value, parsed.source, services, context.cwd));
      environment.permissions.push(...normalizePermissions(parsed.value, parsed.source));
      const value = parsed.value as Record<string, unknown>;
      recordUnknownFields(environment, parsed.source, value, ['mcpServers', 'hooks', 'permissions']);
    }
    await mergeMcpByName(mcpEntries, environment);
    activeSourceIds(environment);
    return environment;
  },
  probeCapabilities(): ProbeCapabilities {
    return { mcpList: 'supported', hookSynthetic: 'unsupported', transcripts: 'unsupported', compactionBenchmark: 'unsupported', subagents: 'unsupported' };
  },
  async activeProbe(request: ActiveProbeRequest, context, services) {
    return probeMcpServer(request, context, services);
  }
};
