import { sha256 } from './fs.js';
import { redactText } from './redaction.js';
import { estimateTokenSet } from './tokens.js';
import type { ConfigSource, InstructionClause, InstructionDocument, SourceLocation, SourceScope } from './model.js';

const directivePattern = /\b(always|never|must\s+not|must|do\s+not|don't|should\s+not|should|avoid)\s+([^.!?\n]+)/i;
const importPattern = /^\s*@(?:import|include)\s+[<"]?([^>"\s]+)[>"]?\s*$/i;

export function parseInstructionClauses(content: string, filePath: string): InstructionClause[] {
  const clauses: InstructionClause[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let scope: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*<!--/.test(line) || /^\s*<!--/.test(line)) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading?.[1]) {
      scope = normalizeClauseText(heading[1]);
      continue;
    }
    const match = line.match(directivePattern);
    if (!match) continue;
    const rawModality = match[1]?.toLowerCase().replace(/\s+/g, ' ') ?? 'directive';
    const rawBody = normalizeClauseText(match[2] ?? '');
    const conditionMatch = rawBody.match(/\b(unless|if|when|only when|for)\s+(.+)$/i);
    const condition = conditionMatch?.[0];
    const body = conditionMatch?.index === undefined ? rawBody : rawBody.slice(0, conditionMatch.index).trim();
    const words = body.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const action = words[0] ?? 'act';
    const object = words.slice(1).join(' ') || action;
    const modality = modalityFor(rawModality);
    const span: SourceLocation = {
      path: filePath,
      line: index + 1,
      column: Math.max(0, line.toLowerCase().indexOf(rawModality)),
      endLine: index + 1,
      endColumn: line.length,
      span: redactText(line.trim()).slice(0, 240),
    };
    clauses.push({
      id: `clause-${sha256(`${filePath}:${index + 1}:${line}`).slice(0, 16)}`,
      modality,
      action,
      object,
      ...(condition ? { condition } : {}),
      ...(scope ? { scope } : {}),
      normalized: `${modality}:${action}:${object}${condition ? `:${condition}` : ''}`,
      sourceSpan: span,
    });
  }
  return clauses;
}

function modalityFor(value: string): InstructionClause['modality'] {
  if (value === 'must' || value === 'always') return value;
  if (value === 'must not' || value === 'do not' || value === "don't" || value === 'never') return value === 'never' ? 'never' : 'must-not';
  if (value === 'should') return 'should';
  if (value === 'should not' || value === 'avoid') return 'should-not';
  return 'directive';
}

function normalizeClauseText(value: string): string {
  return value.toLowerCase().replace(/[`*_>#()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function oppositePolarity(modality: InstructionClause['modality']): InstructionClause['modality'] | undefined {
  if (modality === 'must' || modality === 'always' || modality === 'directive') return 'must-not';
  if (modality === 'should') return 'should-not';
  if (modality === 'must-not' || modality === 'never') return 'must';
  if (modality === 'should-not') return 'should';
  return undefined;
}

export function extractInstructionImports(content: string): string[] {
  const imports: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(importPattern);
    if (match?.[1]) imports.push(match[1]);
  }
  return [...new Set(imports)].sort();
}

export function buildInstructionDocument(source: ConfigSource, rawContent: string, loadMode: InstructionDocument['loadMode'] = 'automatic'): InstructionDocument {
  const content = redactText(rawContent);
  const crlf = (rawContent.match(/\r\n/g) ?? []).length;
  const lf = (rawContent.match(/(?<!\r)\n/g) ?? []).length;
  let newline: InstructionDocument['newline'] = 'lf';
  if (crlf > 0 && lf > 0) newline = 'mixed';
  else if (crlf > 0) newline = 'crlf';
  return {
    id: `${source.id}:instruction`,
    sourceId: source.id,
    path: source.path,
    scope: source.scope as SourceScope,
    loadMode,
    active: true,
    bytes: Buffer.byteLength(rawContent, 'utf8'),
    tokenEstimates: estimateTokenSet(content),
    imports: extractInstructionImports(rawContent),
    clauses: parseInstructionClauses(content, source.path),
    sourceSpan: { path: source.path, line: 1, column: 0 },
    textHash: sha256(rawContent),
    content,
    newline,
    finalNewline: rawContent.endsWith('\n') || rawContent.endsWith('\r'),
  };
}

export function clausePolarityKey(clause: InstructionClause): string {
  return `${clause.action}:${clause.object}`;
}
