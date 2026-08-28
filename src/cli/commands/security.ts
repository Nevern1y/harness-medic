import { runScanCommand, type ScanCommandOptions } from './scan.js';

export async function runSecurityCommand(options: ScanCommandOptions): Promise<number> {
  return runScanCommand({ ...options, doctor: 'security' });
}
