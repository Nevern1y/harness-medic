import { z } from 'zod';
import type { ScanReport } from '../core/model.js';

const severity = z.enum(['critical', 'error', 'warning', 'info']);
const evidenceClass = z.enum(['static', 'runtime', 'behavioral', 'heuristic']);
const confidence = z.enum(['certain', 'high', 'medium', 'low']);
const sourceLocation = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  endColumn: z.number().int().nonnegative().optional(),
  span: z.string().optional(),
}).strict();
const evidenceItem = z.object({
  id: z.string(),
  kind: z.enum(['observation', 'comparison', 'span', 'metric', 'configuration', 'coverage']),
  summary: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  sourceId: z.string().optional(),
  location: sourceLocation.optional(),
  evidenceClass,
}).strict();
const tokenEstimate = z.object({
  estimator: z.enum(['o200k_base', 'cl100k_base', 'byte-fallback']),
  tokens: z.number().int().nonnegative(),
  exact: z.boolean(),
}).strict();
const sourceDiagnostic = z.object({
  code: z.string(),
  message: z.string(),
  severity,
  location: sourceLocation.optional(),
}).strict();
const configSource = z.object({
  id: z.string(),
  harness: z.enum(['claude-code', 'codex', 'opencode', 'cursor']),
  kind: z.enum(['settings', 'mcp', 'instruction', 'hook', 'permission', 'plugin', 'baseline', 'transcript']),
  scope: z.enum(['managed', 'user', 'project', 'local', 'plugin', 'runtime', 'workspace', 'unknown']),
  path: z.string(),
  priority: z.number().int(),
  applicable: z.boolean(),
  ownership: z.enum(['user', 'workspace', 'managed', 'third-party', 'unknown']),
  contentHash: z.string().optional(),
  parser: z.enum(['json', 'jsonc', 'yaml', 'toml', 'markdown', 'opaque']),
  parseStatus: z.enum(['parsed', 'invalid', 'unavailable', 'unsupported']),
  diagnostics: z.array(sourceDiagnostic),
  discoveredBy: z.string(),
  formatVersion: z.string().optional(),
  lexicalPath: z.string().optional(),
  realPath: z.string().optional(),
}).strict();
const instructionClause = z.object({
  id: z.string(),
  modality: z.enum(['must', 'must-not', 'should', 'should-not', 'always', 'never', 'directive', 'unknown']),
  action: z.string(),
  object: z.string(),
  condition: z.string().optional(),
  scope: z.string().optional(),
  normalized: z.string(),
  sourceSpan: sourceLocation,
}).strict();
const instruction = z.object({
  id: z.string(),
  sourceId: z.string(),
  path: z.string(),
  scope: z.enum(['managed', 'user', 'project', 'local', 'plugin', 'runtime', 'workspace', 'unknown']),
  loadMode: z.enum(['automatic', 'imported', 'conditional', 'unknown']),
  active: z.boolean(),
  bytes: z.number().int().nonnegative(),
  tokenEstimates: z.array(tokenEstimate),
  imports: z.array(z.string()),
  clauses: z.array(instructionClause),
  sourceSpan: sourceLocation,
  textHash: z.string(),
  content: z.string(),
  newline: z.enum(['lf', 'crlf', 'mixed']),
  finalNewline: z.boolean(),
}).strict();
const observation = z.object({
  id: z.string(),
  status: z.enum(['observed', 'failed', 'timed-out', 'declined', 'unsupported', 'not-run']),
  startedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  attempts: z.number().int().nonnegative(),
  evidence: z.array(z.object({
    kind: z.string(),
    value: z.string(),
    location: sourceLocation.optional(),
  }).strict()),
  cleanupStatus: z.enum(['clean', 'forced', 'failed', 'not-applicable', 'unknown']).optional(),
  errorCode: z.string().optional(),
}).strict();
const toolMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  metadataHash: z.string().optional(),
}).strict();
const mcpServer = z.object({
  id: z.string(),
  sourceId: z.string(),
  configuredName: z.string(),
  canonicalIdentity: z.string(),
  transport: z.enum(['stdio', 'sse', 'streamable-http', 'unknown']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  envKeyNames: z.array(z.string()),
  envFingerprint: z.string().optional(),
  enabled: z.boolean(),
  active: z.boolean(),
  trust: z.enum(['managed', 'user', 'workspace', 'third-party', 'unknown']),
  toolInventory: z.object({
    tools: z.array(toolMetadata),
    observed: z.boolean(),
    observationId: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
    tokenEstimates: z.array(tokenEstimate).optional(),
  }).strict().optional(),
  observation: observation.optional(),
  configLocation: sourceLocation.optional(),
  rawMetadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
const hook = z.object({
  id: z.string(),
  sourceId: z.string(),
  event: z.string(),
  matcher: z.string().optional(),
  kind: z.enum(['command', 'prompt', 'agent', 'unknown']),
  target: z.string(),
  resolvedTarget: z.string().optional(),
  timeout: z.number().nonnegative().optional(),
  active: z.boolean(),
  validation: z.array(z.object({ code: z.string(), valid: z.boolean(), message: z.string() }).strict()),
  observation: observation.optional(),
  location: sourceLocation.optional(),
}).strict();
const permission = z.object({
  id: z.string(),
  sourceId: z.string(),
  action: z.string(),
  pattern: z.string().optional(),
  mode: z.enum(['allow', 'deny', 'ask', 'unknown']),
  active: z.boolean(),
}).strict();
const environment = z.object({
  harness: z.enum(['claude-code', 'codex', 'opencode', 'cursor']),
  adapterVersion: z.string(),
  harnessVersion: z.string().optional(),
  workspace: z.string(),
  detected: z.boolean(),
  sources: z.array(configSource),
  activeSourceIds: z.array(z.string()),
  shadowEdges: z.array(z.object({
    fromSourceId: z.string(), toSourceId: z.string(), reason: z.string(), subject: z.string().optional(),
  }).strict()),
  coverageGaps: z.array(z.object({
    id: z.string(), area: z.string(), reason: z.string(), impact: z.enum(['low', 'medium', 'high']), source: z.string().optional(),
  }).strict()),
  instructions: z.array(instruction),
  mcpServers: z.array(mcpServer),
  tools: z.array(toolMetadata),
  hooks: z.array(hook),
  subagents: z.array(z.string()),
  permissions: z.array(permission),
  unknownFields: z.record(z.string(), z.unknown()),
}).strict();
const finding = z.object({
  id: z.string(),
  ruleId: z.string(),
  doctor: z.enum(['context', 'rules', 'mcp', 'hooks', 'security', 'internal', 'benchmark', 'baseline']),
  severity,
  evidenceClass,
  confidence,
  title: z.string(),
  summary: z.string(),
  impact: z.string(),
  evidence: z.array(evidenceItem),
  locations: z.array(sourceLocation),
  remediation: z.string(),
  references: z.array(z.string()),
  applicable: z.boolean(),
  observed: z.boolean(),
  scoreEligible: z.boolean(),
  scoreImpact: z.number().nonnegative(),
  fixSafety: z.enum(['safe', 'review', 'manual']),
  fixIds: z.array(z.string()),
  precisionStatus: z.enum(['unmeasured', 'corpus-estimate', 'validated']).optional(),
}).strict();
const fixPlan = z.object({
  id: z.string(),
  findingIds: z.array(z.string()),
  safety: z.enum(['safe', 'review', 'manual']),
  operations: z.array(z.object({
    id: z.string(), path: z.string(), kind: z.enum(['json-delete', 'json-set', 'text-replace', 'copy']),
    parser: z.enum(['json', 'jsonc', 'yaml', 'toml', 'markdown', 'opaque']), selector: z.string().optional(),
    beforeHash: z.string(), beforeBytes: z.number().int().nonnegative(), afterText: z.string().optional(), replacement: z.string().optional(),
    lineEnding: z.enum(['lf', 'crlf', 'mixed']), description: z.string(),
  }).strict()),
  preconditions: z.array(z.object({ path: z.string(), contentHash: z.string() }).strict()),
  postconditions: z.array(z.object({ description: z.string(), paths: z.array(z.string()), ruleIds: z.array(z.string()).optional() }).strict()),
  affectedPaths: z.array(z.string()),
  preview: z.string(),
}).strict();

export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.object({ name: z.literal('harness-medic'), version: z.string() }).strict(),
  scan: z.object({ id: z.string(), startedAt: z.string(), durationMs: z.number().nonnegative(), tier: z.union([z.literal(0), z.literal(1), z.literal(2)]) }).strict(),
  workspace: z.string(),
  privacy: z.object({ redacted: z.boolean(), valuesSerialized: z.literal(false), networkRequests: z.number().int().nonnegative(), childProcesses: z.number().int().nonnegative(), notes: z.array(z.string()) }).strict(),
  coverage: z.array(z.object({
    harness: z.enum(['claude-code', 'codex', 'opencode', 'cursor']), detected: z.boolean(), parsed: z.boolean(), precedenceModeled: z.boolean(), runtimeProbed: z.boolean(), behaviorObserved: z.boolean(), gaps: z.array(z.unknown()),
  }).strict()),
  environments: z.array(environment),
  observations: z.array(observation),
  findings: z.array(finding),
  summary: z.object({
    bySeverity: z.object({ critical: z.number().int().nonnegative(), error: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), info: z.number().int().nonnegative() }).strict(),
    byDoctor: z.record(z.string(), z.number().int().nonnegative()), applicable: z.number().int().nonnegative(), observed: z.number().int().nonnegative(), unscored: z.number().int().nonnegative(), healthIndex: z.number().int().min(0).max(100).optional(), deductions: z.array(z.object({ ruleId: z.string(), doctor: z.string(), amount: z.number().nonnegative(), capped: z.boolean() }).strict()),
  }).strict(),
  fixPlans: z.array(fixPlan),
  internalDiagnostics: z.array(z.object({ id: z.string(), phase: z.enum(['discovery', 'parse', 'resolve', 'check', 'report', 'probe', 'fix', 'baseline', 'benchmark']), message: z.string(), sourceId: z.string().optional(), harness: z.enum(['claude-code', 'codex', 'opencode', 'cursor']).optional(), recoverable: z.boolean() }).strict()),
}).strict();

export type Report = ScanReport;
export function validateReport(input: unknown): input is ScanReport {
  return reportSchema.safeParse(input).success;
}
export function parseReport(input: unknown): ScanReport {
  return reportSchema.parse(input) as ScanReport;
}