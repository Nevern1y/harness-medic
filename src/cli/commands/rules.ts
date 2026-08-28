import { runScanCommand, type ScanCommandOptions } from './scan.js';

export async function runRulesCommand(options: ScanCommandOptions): Promise<number> {
  return runScanCommand({ ...options, doctor: 'rules' });
}
