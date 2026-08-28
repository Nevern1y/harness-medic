import type { HookRegistration, Observation, ScanContext, ScanServices } from '../core/model.js';

export async function probeHook(_hook: HookRegistration, _context: ScanContext, _services: ScanServices): Promise<Observation> {
  return {
    id: `observation:hook:${_hook.id}`,
    status: 'unsupported',
    attempts: 0,
    evidence: [{ kind: 'capability', value: 'no harness-native or approved inert hook sandbox is available' }],
    cleanupStatus: 'not-applicable',
    errorCode: 'UNSUPPORTED_SAFE_PATH',
  };
}
