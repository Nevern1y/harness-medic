import type { EffectiveEnvironment, HarnessAdapter, HarnessId, InternalDiagnostic, ParsedSource, ScanContext, ScanServices } from '../core/model.js';
import { redactText } from '../core/redaction.js';
import { selectAdapters } from '../adapters/index.js';

export interface AdapterRun {
  adapter: HarnessAdapter;
  detection: { installed: boolean; configured: boolean; evidence: string[] };
  sources: Awaited<ReturnType<HarnessAdapter['discover']>>;
  parsedSources: ParsedSource[];
  environment?: EffectiveEnvironment;
}

export interface DiscoveryResult {
  runs: AdapterRun[];
  environments: EffectiveEnvironment[];
  internalDiagnostics: InternalDiagnostic[];
}

export async function discoverEnvironments(context: ScanContext, services: ScanServices): Promise<DiscoveryResult> {
  const runs: AdapterRun[] = [];
  const environments: EffectiveEnvironment[] = [];
  const internalDiagnostics: InternalDiagnostic[] = [];
  for (const adapter of selectAdapters(context.selectedHarnesses)) {
    let detection = { installed: false, configured: false, evidence: [] as string[] };
    let sources: Awaited<ReturnType<HarnessAdapter['discover']>> = [];
    const parsedSources: ParsedSource[] = [];
    try {
      detection = await adapter.detect(context, services);
      sources = await adapter.discover(context, services);
      for (const source of sources) {
        try {
          parsedSources.push(await adapter.parse(source, context, services));
        } catch (error) {
          source.parseStatus = 'invalid';
          source.diagnostics.push({ code: 'ADAPTER_PARSE_FAILED', message: redactText(error instanceof Error ? error.message : String(error)), severity: 'error', location: { path: source.path } });
          parsedSources.push({ source, value: undefined, content: '', bytes: 0, newline: 'lf', finalNewline: false });
          internalDiagnostics.push({ id: `parse:${source.id}`, phase: 'parse', message: source.diagnostics.at(-1)?.message ?? 'source parse failed', sourceId: source.id, harness: adapter.id, recoverable: true });
        }
      }
      const environment = await adapter.resolve(parsedSources, context, services);
      runs.push({ adapter, detection, sources, parsedSources, environment });
      environments.push(environment);
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : String(error));
      internalDiagnostics.push({ id: `adapter:${adapter.id}`, phase: 'resolve', message, harness: adapter.id, recoverable: true });
      runs.push({ adapter, detection, sources, parsedSources });
    }
  }
  return { runs, environments, internalDiagnostics };
}

export function hasSupportedEnvironment(environments: EffectiveEnvironment[]): boolean {
  return environments.some((environment) => environment.detected || environment.sources.length > 0);
}

export function harnessIdsFor(environments: EffectiveEnvironment[]): HarnessId[] {
  return environments.map((environment) => environment.harness).sort();
}
