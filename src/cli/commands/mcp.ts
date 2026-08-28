import { runScanCommand, type ScanCommandOptions } from './scan.js';

export async function runMcpCommand(options: ScanCommandOptions): Promise<number> {
  return runScanCommand({ ...options, doctor: 'mcp' });
}
