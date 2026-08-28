import { tempJournalPath, readTextFile, sha256 } from '../core/fs.js';
import { redactText } from '../core/redaction.js';
import { deleteJsoncPath, parseContent, setJsoncPath } from '../parsers/index.js';
import type { FileSystem, FixOperation, FixPlan, ScanServices } from '../core/model.js';

export interface TransactionOptions {
  dryRun?: boolean;
  failAfterOperation?: number;
  validate?: (paths: string[]) => Promise<void>;
}

export interface TransactionResult {
  status: 'planned' | 'committed' | 'rolled-back' | 'rollback-failed' | 'aborted';
  code: 0 | 4 | 5;
  journalPath?: string;
  error?: string;
  restoredPaths: string[];
}

export async function applyFixPlan(plan: FixPlan, services: ScanServices, options: TransactionOptions = {}): Promise<TransactionResult> {
  if (options.dryRun !== false) return { status: 'planned', code: 0, restoredPaths: [] };
  const originals = new Map<string, Buffer>();
  const journalPath = tempJournalPath(plan.id);
  try {
    await services.fs.mkdir(journalDirectory(journalPath), { recursive: true });
    for (const precondition of plan.preconditions) {
      const bytes = await services.fs.readFile(precondition.path);
      originals.set(precondition.path, bytes);
      if (sha256(bytes) !== precondition.contentHash) return { status: 'aborted', code: 4, error: redactText(`Precondition changed for ${precondition.path}`), restoredPaths: [] };
    }
    const journal = JSON.stringify({ planId: plan.id, files: [...originals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([filePath, bytes]) => ({ path: filePath, bytes: bytes.toString('base64') })) });
    await services.fs.writeFile(journalPath, Buffer.from(journal, 'utf8'));
    await services.fs.chmod?.(journalPath, 0o600);
    const operationsByPath = new Map<string, FixOperation[]>();
    for (const operation of plan.operations) {
      const group = operationsByPath.get(operation.path) ?? [];
      group.push(operation);
      operationsByPath.set(operation.path, group);
    }
    let completed = 0;
    for (const [filePath, operations] of operationsByPath.entries()) {
      let current = await readTextFile(services.fs, filePath);
      const firstOperation = operations[0];
      if (!firstOperation || sha256(current.content) !== firstOperation.beforeHash) throw new Error(redactText(`Precondition changed for ${filePath}`));
      for (const operation of operations) {
        current = applyOperation(operation, current);
        completed += 1;
        if (options.failAfterOperation !== undefined && completed >= options.failAfterOperation) throw new Error('Injected transaction failure');
      }
      const bytes = encodeText(current.content, current.newline, current.finalNewline, current.bom);
      await services.fs.writeFile(filePath, bytes);
    }
    if (options.validate) await options.validate(plan.affectedPaths);
    await validateJsonOperations(plan, services.fs);
    await services.fs.unlink(journalPath).catch(() => undefined);
    return { status: 'committed', code: 0, restoredPaths: [] };
  } catch (error) {
    const restoredPaths: string[] = [];
    let rollbackFailed = false;
    for (const [filePath, bytes] of originals.entries()) {
      try {
        await services.fs.writeFile(filePath, bytes);
        const restored = await services.fs.readFile(filePath);
        if (!restored.equals(bytes)) rollbackFailed = true;
        else restoredPaths.push(filePath);
      } catch {
        rollbackFailed = true;
      }
    }
    await services.fs.unlink(journalPath).catch(() => undefined);
    return { status: rollbackFailed ? 'rollback-failed' : 'rolled-back', code: rollbackFailed ? 5 : 4, journalPath, error: redactText(error instanceof Error ? error.message : String(error)), restoredPaths };
  }
}

function applyOperation(operation: FixOperation, current: Awaited<ReturnType<typeof readTextFile>>) {
  if (operation.kind === 'json-delete' && operation.selector) {
    const pathSegments = operation.selector.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
    return { ...current, content: deleteJsoncPath(current.content, pathSegments) };
  }
  if (operation.kind === 'json-set' && operation.selector) {
    const pathSegments = operation.selector.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
    return { ...current, content: setJsoncPath(current.content, pathSegments, operation.replacement) };
  }
  if (operation.kind === 'text-replace' && operation.replacement !== undefined) return { ...current, content: current.content.replace(operation.selector ?? '', operation.replacement) };
  return current;
}

async function validateJsonOperations(plan: FixPlan, fs: FileSystem): Promise<void> {
  for (const operation of plan.operations) {
    if (operation.parser !== 'json' && operation.parser !== 'jsonc') continue;
    const file = await readTextFile(fs, operation.path);
    const parsed = parseContent(file.content, operation.parser);
    if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) throw new Error(`Post-write JSON validation failed for ${operation.path}`);
  }
}

function encodeText(content: string, newline: 'lf' | 'crlf' | 'mixed', finalNewline: boolean, bom: boolean): Buffer {
  let output = content;
  if (newline === 'crlf') output = output.replace(/\r?\n/g, '\r\n');
  if (finalNewline && !output.endsWith('\n')) output += newline === 'crlf' ? '\r\n' : '\n';
  return Buffer.from(`${bom ? '\uFEFF' : ''}${output}`, 'utf8');
}

function journalDirectory(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separator >= 0 ? filePath.slice(0, separator) : '.';
}
