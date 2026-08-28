import { sha256 } from './fs.js';

const sensitiveKeyPattern = /(pass(word)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret|authorization|cookie|credential|env(ironment)?[_-]?value)/i;
const secretStringPatterns: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|github_pat|xox[baprs])-[A-Za-z0-9_-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\bCANARY_[A-Z0-9_]+\b/g,
];
const assignmentPattern = /((?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?key|authorization|cookie|credential|env(?:ironment)?[_-]?value)\s*[:=]\s*)([^\s,;)}\]]+)/gi;
const safeStructuredKeys = new Set(['tokenEstimates']);

export const REDACTED = '[REDACTED]';

export function containsPotentialSecret(input: string): boolean {
  if (assignmentPattern.test(input)) {
    assignmentPattern.lastIndex = 0;
    return true;
  }
  assignmentPattern.lastIndex = 0;
  for (const pattern of secretStringPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(input)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}

export function redactText(input: string): string {
  let output = input.replace(assignmentPattern, `$1${REDACTED}`);
  for (const pattern of secretStringPatterns) output = output.replace(pattern, REDACTED);
  return output;
}

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}

export function redactValue(value: unknown, keyHint?: string): unknown {
  if (keyHint && safeStructuredKeys.has(keyHint)) return value;
  if (keyHint && isSensitiveKey(keyHint)) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) output[key] = redactValue(child, key);
    return output;
  }
  return value;
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>;
}

export function fingerprintSecret(value: string, salt: string): string {
  return sha256(`${salt}:${value}`);
}

export function redactCommandArgs(command: string, args: string[]): { command: string; args: string[] } {
  const output: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      output.push(REDACTED);
      redactNext = false;
      continue;
    }
    const lower = arg.toLowerCase();
    if (lower.startsWith('--') && (lower.includes('token') || lower.includes('secret') || lower.includes('password') || lower.includes('key'))) {
      output.push(arg.includes('=') ? `${arg.slice(0, arg.indexOf('=') + 1)}${REDACTED}` : arg);
      redactNext = !arg.includes('=');
      continue;
    }
    output.push(redactText(arg));
  }
  return { command: redactText(command), args: output };
}

export function redactUnknownFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const redacted = redactValue(value) as Record<string, unknown>;
  for (const key of Object.keys(redacted)) {
    if (isSensitiveKey(key)) redacted[key] = REDACTED;
  }
  return redacted;
}
