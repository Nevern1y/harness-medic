import { runScanCommand, type ScanCommandOptions } from './scan.js';

export async function runContextCommand(options: ScanCommandOptions): Promise<number> {
  return runScanCommand({ ...options, doctor: 'context' });
}
