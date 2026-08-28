import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { readTextFile, sha256 } from '../core/fs.js';
import { containsPotentialSecret, redactText } from '../core/redaction.js';
import type { ConfigSource, FileSystem, ParsedSource, ParserName, SourceDiagnostic, Severity } from '../core/model.js';

export function parserForPath(filePath: string, kind: ConfigSource['kind']): ParserName {
  if (kind === 'instruction') return 'markdown';
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jsonc')) return 'jsonc';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  return 'opaque';
}

export async function parseSourceFile(fs: FileSystem, source: ConfigSource): Promise<ParsedSource> {
  try {
    const textFile = await readTextFile(fs, source.path);
    const parsed = parseContent(textFile.content, source.parser);
    source.contentHash = sha256(textFile.content);
    const diagnostics = [...parsed.diagnostics];
    if (containsPotentialSecret(textFile.content)) diagnostics.push({ code: 'PLAINTEXT_SECRET', message: 'Structural secret detector matched a value; the value is redacted from all output.', severity: 'warning' });
    source.parseStatus = diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'invalid' : 'parsed';
    source.diagnostics = diagnostics;
    return {
      source,
      value: parsed.value,
      content: textFile.content,
      bytes: textFile.bytes,
      newline: textFile.newline,
      finalNewline: textFile.finalNewline,
    };
  } catch (error) {
    source.parseStatus = 'invalid';
    source.diagnostics = [{
      code: 'READ_FAILED',
      message: redactText(error instanceof Error ? error.message : String(error)),
      severity: 'error',
      location: { path: source.path },
    }];
    return {
      source,
      value: undefined,
      content: '',
      bytes: 0,
      newline: 'lf',
      finalNewline: false,
    };
  }
}

export function parseContent(content: string, parser: ParserName): { value: unknown; diagnostics: SourceDiagnostic[] } {
  if (parser === 'markdown' || parser === 'opaque') return { value: content, diagnostics: [] };
  if (parser === 'json' || parser === 'jsonc') return parseJson(content, parser === 'jsonc');
  if (parser === 'yaml') return parseYamlContent(content);
  if (parser === 'toml') return parseTomlContent(content);
  return { value: undefined, diagnostics: [{ code: 'UNSUPPORTED_PARSER', message: `Parser ${parser} is not supported`, severity: 'error' }] };
}

function parseJson(content: string, allowJsonc: boolean): { value: unknown; diagnostics: SourceDiagnostic[] } {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const value = parseJsonc(content, errors, { allowTrailingComma: allowJsonc, disallowComments: !allowJsonc });
  const diagnostics = errors.map((entry) => ({
    code: `${allowJsonc ? 'JSONC' : 'JSON'}_${entry.error}`,
    message: `${allowJsonc ? 'JSONC' : 'JSON'} parse error at offset ${entry.offset}`,
    severity: 'error' as Severity,
    location: { path: '<source>', span: content.slice(entry.offset, entry.offset + Math.max(1, entry.length)) },
  }));
  return { value, diagnostics };
}

function parseYamlContent(content: string): { value: unknown; diagnostics: SourceDiagnostic[] } {
  try {
    const value = parseYaml(content, { strict: true });
    return { value, diagnostics: [] };
  } catch (error) {
    return {
      value: undefined,
      diagnostics: [{ code: 'YAML_PARSE_ERROR', message: redactText(error instanceof Error ? error.message : String(error)), severity: 'error' }],
    };
  }
}

function parseTomlContent(content: string): { value: unknown; diagnostics: SourceDiagnostic[] } {
  try {
    return { value: parseToml(content), diagnostics: [] };
  } catch (error) {
    return {
      value: undefined,
      diagnostics: [{ code: 'TOML_PARSE_ERROR', message: redactText(error instanceof Error ? error.message : String(error)), severity: 'error' }],
    };
  }
}

export function deleteJsoncPath(content: string, pathSegments: Array<string | number>): string {
  const edits = modify(content, pathSegments, undefined, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return applyEdits(content, edits);
}

export function setJsoncPath(content: string, pathSegments: Array<string | number>, value: unknown): string {
  const edits = modify(content, pathSegments, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return applyEdits(content, edits);
}
