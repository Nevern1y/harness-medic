import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { stableJson } from '../core/evidence.js';
import { redactValue } from '../core/redaction.js';
import { reportSchema } from '../generated/report-schema.js';
import type { ScanReport } from '../core/model.js';

export function formatJson(report: ScanReport): string {
  const safe = reportSchema.parse(redactValue(report));
  return `${stableJson(safe)}\n`;
}

export async function writeJsonAtomically(filePath: string, report: ScanReport): Promise<void> {
  const directory = path.dirname(filePath);
  await nodeFs.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await nodeFs.writeFile(temporary, formatJson(report), 'utf8');
    await nodeFs.rename(temporary, filePath);
  } finally {
    await nodeFs.unlink(temporary).catch(() => undefined);
  }
}
