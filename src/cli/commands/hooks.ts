import { runScanCommand, type ScanCommandOptions } from './scan.js';

export async function runHooksCommand(options: ScanCommandOptions): Promise<number> {
  return runScanCommand({ ...options, doctor: 'hooks' });
}
