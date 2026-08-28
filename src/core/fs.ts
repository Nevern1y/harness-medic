import { createHash, randomBytes } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { homedir, platform as nodePlatform, tmpdir } from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import type { FileSystem, ScanContext, ScanServices } from './model.js';

export class NodeFileSystem implements FileSystem {
  async readFile(filePath: string): Promise<Buffer> {
    return nodeFs.readFile(filePath);
  }

  async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    await nodeFs.writeFile(filePath, data);
  }

  async stat(filePath: string) {
    return nodeFs.stat(filePath);
  }

  async lstat(filePath: string) {
    return nodeFs.lstat(filePath);
  }

  async realpath(filePath: string): Promise<string> {
    return nodeFs.realpath(filePath);
  }

  async readdir(filePath: string): Promise<string[]> {
    return nodeFs.readdir(filePath);
  }

  async mkdir(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    await nodeFs.mkdir(filePath, options);
  }

  async rename(from: string, to: string): Promise<void> {
    await nodeFs.rename(from, to);
  }

  async chmod(filePath: string, mode: number): Promise<void> {
    await nodeFs.chmod(filePath, mode);
  }

  async unlink(filePath: string): Promise<void> {
    await nodeFs.unlink(filePath);
  }

  async access(filePath: string): Promise<boolean> {
    try {
      await nodeFs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async glob(patterns: string[], cwd: string): Promise<string[]> {
    return fg(patterns, {
      cwd,
      absolute: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      unique: true,
    });
  }
}

export interface TextFile {
  path: string;
  content: string;
  bytes: number;
  newline: 'lf' | 'crlf' | 'mixed';
  finalNewline: boolean;
  bom: boolean;
}

export async function readTextFile(fs: FileSystem, filePath: string): Promise<TextFile> {
  const bytes = await fs.readFile(filePath);
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const content = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
  let newline: TextFile['newline'] = 'lf';
  if (crlf > 0 && lf > 0) newline = 'mixed';
  else if (crlf > 0) newline = 'crlf';
  return {
    path: filePath,
    content,
    bytes: bytes.length,
    newline,
    finalNewline: content.endsWith('\n') || content.endsWith('\r'),
    bom,
  };
}

export async function pathExists(fs: FileSystem, filePath: string): Promise<boolean> {
  return fs.access(filePath);
}

export async function safeRealpath(fs: FileSystem, filePath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return undefined;
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createServices(fs: FileSystem = new NodeFileSystem(), targetPlatform: NodeJS.Platform = nodePlatform()): ScanServices {
  const isWindows = targetPlatform === 'win32';
  return {
    fs,
    isWindows,
    redactionSalt: randomBytes(16).toString('hex'),
    now: () => new Date(),
    resolveExecutable: async (command: string, cwd: string) => resolveExecutable(fs, command, cwd, isWindows),
  };
}

export function createScanContext(overrides: Partial<ScanContext> = {}): ScanContext {
  const currentPlatform = nodePlatform();
  const defaultContext: ScanContext = {
    cwd: path.resolve(process.cwd()),
    home: homedir(),
    platform: currentPlatform,
    envNames: Object.keys(process.env).sort(),
    selectedHarnesses: ['claude-code', 'codex', 'opencode', 'cursor'],
    scanTier: 0,
    consentPolicy: {
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      allowNetwork: false,
      allowServers: [],
      allowHooks: false,
      allowUntrusted: false,
    },
  };
  return {
    ...defaultContext,
    ...overrides,
    selectedHarnesses: overrides.selectedHarnesses ?? defaultContext.selectedHarnesses,
    consentPolicy: { ...defaultContext.consentPolicy, ...(overrides.consentPolicy ?? {}) },
  };
}

export function resolvePathFrom(base: string, candidate: string, isWindows = process.platform === 'win32'): string {
  const pathApi = isWindows ? path.win32 : path.posix;
  if (pathApi.isAbsolute(candidate)) return pathApi.normalize(candidate);
  return pathApi.resolve(base, candidate);
}

export function ancestorDirectories(start: string, isWindows = process.platform === 'win32'): string[] {
  const pathApi = isWindows ? path.win32 : path.posix;
  const output: string[] = [];
  let current = pathApi.resolve(start);
  while (true) {
    output.push(current);
    const parent = pathApi.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return output.reverse();
}

export async function resolveExecutable(fs: FileSystem, command: string, cwd: string, isWindows: boolean): Promise<string | undefined> {
  const trimmed = command.trim();
  if (trimmed.length === 0) return undefined;
  const pathApi = isWindows ? path.win32 : path.posix;
  const hasPath = trimmed.includes('/') || trimmed.includes('\\') || pathApi.isAbsolute(trimmed);
  const pathValue = process.env.PATH ?? '';
  const pathEntries = hasPath ? [resolvePathFrom(cwd, trimmed, isWindows)] : pathValue.split(isWindows ? ';' : path.delimiter).filter(Boolean).map((entry) => pathApi.join(entry, trimmed));
  const extensions = isWindows ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((entry) => entry.toLowerCase())] : [''];
  for (const candidate of pathEntries) {
    const variants = hasPath ? [candidate, ...extensions.filter((extension) => extension && !candidate.toLowerCase().endsWith(extension)).map((extension) => `${candidate}${extension}`)] : extensions.map((extension) => `${candidate}${extension}`);
    for (const variant of variants) {
      try {
        const stats = await fs.stat(variant);
        if (stats.isFile()) return pathApi.normalize(variant);
      } catch {
        // Continue searching PATH candidates without exposing filesystem errors.
      }
    }
  }
  return undefined;
}

export function tempJournalPath(id: string): string {
  return path.join(tmpdir(), `harness-medic-${id}.json`);
}

export function normalizePathForIdentity(filePath: string, isWindows: boolean): string {
  const pathApi = isWindows ? path.win32 : path.posix;
  const normalized = pathApi.normalize(filePath).replaceAll('\\', '/');
  return isWindows ? normalized.toLowerCase() : normalized;
}
