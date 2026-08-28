import type { Stats } from 'node:fs';

export const HARNESS_IDS = ['claude-code', 'codex', 'opencode', 'cursor'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const EVIDENCE_CLASSES = ['static', 'runtime', 'behavioral', 'heuristic'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ['certain', 'high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const OBSERVATION_STATUSES = [
  'observed',
  'failed',
  'timed-out',
  'declined',
  'unsupported',
  'not-run',
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export type ScanTier = 0 | 1 | 2;
export type SourceScope = 'managed' | 'user' | 'project' | 'local' | 'plugin' | 'runtime' | 'workspace' | 'unknown';
export type SourceKind = 'settings' | 'mcp' | 'instruction' | 'hook' | 'permission' | 'plugin' | 'baseline' | 'transcript';
export type ParserName = 'json' | 'jsonc' | 'yaml' | 'toml' | 'markdown' | 'opaque';
export type ParseStatus = 'parsed' | 'invalid' | 'unavailable' | 'unsupported';
export type FixSafety = 'safe' | 'review' | 'manual';
export type PrecisionStatus = 'unmeasured' | 'corpus-estimate' | 'validated';
export type TransportKind = 'stdio' | 'sse' | 'streamable-http' | 'unknown';
export type HookKind = 'command' | 'prompt' | 'agent' | 'unknown';

export interface FileSystem {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  chmod?(path: string, mode: number): Promise<void>;
  unlink(path: string): Promise<void>;
  access(path: string): Promise<boolean>;
  glob(patterns: string[], cwd: string): Promise<string[]>;
}

export interface ConsentPolicy {
  interactive: boolean;
  allowNetwork: boolean;
  allowServers: string[];
  allowHooks: boolean;
  allowUntrusted: boolean;
}

export interface ScanContext {
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  envNames: string[];
  selectedHarnesses: HarnessId[];
  scanTier: ScanTier;
  consentPolicy: ConsentPolicy;
}

export interface ScanServices {
  fs: FileSystem;
  now(): Date;
  redactionSalt: string;
  resolveExecutable(command: string, cwd: string): Promise<string | undefined>;
  isWindows: boolean;
}

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  span?: string;
}

export interface SourceDiagnostic {
  code: string;
  message: string;
  severity: Severity;
  location?: SourceLocation;
}

export interface ConfigSource {
  id: string;
  harness: HarnessId;
  kind: SourceKind;
  scope: SourceScope;
  path: string;
  priority: number;
  applicable: boolean;
  ownership: 'user' | 'workspace' | 'managed' | 'third-party' | 'unknown';
  contentHash?: string;
  parser: ParserName;
  parseStatus: ParseStatus;
  diagnostics: SourceDiagnostic[];
  discoveredBy: string;
  formatVersion?: string;
  lexicalPath?: string;
  realPath?: string;
}

export interface TokenEstimate {
  estimator: 'o200k_base' | 'cl100k_base' | 'byte-fallback';
  tokens: number;
  exact: boolean;
}

export interface InstructionClause {
  id: string;
  modality: 'must' | 'must-not' | 'should' | 'should-not' | 'always' | 'never' | 'directive' | 'unknown';
  action: string;
  object: string;
  condition?: string;
  scope?: string;
  normalized: string;
  sourceSpan: SourceLocation;
}

export interface InstructionDocument {
  id: string;
  sourceId: string;
  path: string;
  scope: SourceScope;
  loadMode: 'automatic' | 'imported' | 'conditional' | 'unknown';
  active: boolean;
  bytes: number;
  tokenEstimates: TokenEstimate[];
  imports: string[];
  clauses: InstructionClause[];
  sourceSpan: SourceLocation;
  textHash: string;
  content: string;
  newline: 'lf' | 'crlf' | 'mixed';
  finalNewline: boolean;
}

export interface ToolMetadata {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  metadataHash?: string;
}

export interface ToolInventory {
  tools: ToolMetadata[];
  observed: boolean;
  observationId?: string;
  bytes?: number;
  tokenEstimates?: TokenEstimate[];
}

export interface ObservationEvidence {
  kind: string;
  value: string;
  location?: SourceLocation;
}

export interface Observation {
  id: string;
  status: ObservationStatus;
  startedAt?: string;
  durationMs?: number;
  attempts: number;
  evidence: ObservationEvidence[];
  cleanupStatus?: 'clean' | 'forced' | 'failed' | 'not-applicable' | 'unknown';
  errorCode?: string;
}

export interface McpServer {
  id: string;
  sourceId: string;
  configuredName: string;
  canonicalIdentity: string;
  transport: TransportKind;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeyNames: string[];
  envFingerprint?: string;
  enabled: boolean;
  active: boolean;
  trust: 'managed' | 'user' | 'workspace' | 'third-party' | 'unknown';
  toolInventory?: ToolInventory;
  observation?: Observation;
  configLocation?: SourceLocation;
  rawMetadata?: Record<string, unknown>;
}

export interface HookValidation {
  code: string;
  valid: boolean;
  message: string;
}

export interface HookRegistration {
  id: string;
  sourceId: string;
  event: string;
  matcher?: string;
  kind: HookKind;
  target: string;
  resolvedTarget?: string;
  timeout?: number;
  active: boolean;
  validation: HookValidation[];
  observation?: Observation;
  location?: SourceLocation;
}

export interface PermissionRule {
  id: string;
  sourceId: string;
  action: string;
  pattern?: string;
  mode: 'allow' | 'deny' | 'ask' | 'unknown';
  active: boolean;
}

export interface ShadowEdge {
  fromSourceId: string;
  toSourceId: string;
  reason: string;
  subject?: string;
}

export interface CoverageGap {
  id: string;
  area: string;
  reason: string;
  impact: 'low' | 'medium' | 'high';
  source?: string;
}

export interface EffectiveEnvironment {
  harness: HarnessId;
  adapterVersion: string;
  harnessVersion?: string;
  workspace: string;
  detected: boolean;
  sources: ConfigSource[];
  activeSourceIds: string[];
  shadowEdges: ShadowEdge[];
  coverageGaps: CoverageGap[];
  instructions: InstructionDocument[];
  mcpServers: McpServer[];
  tools: ToolMetadata[];
  hooks: HookRegistration[];
  subagents: string[];
  permissions: PermissionRule[];
  unknownFields: Record<string, unknown>;
}

export interface EvidenceItem {
  id: string;
  kind: 'observation' | 'comparison' | 'span' | 'metric' | 'configuration' | 'coverage';
  summary: string;
  value?: string | number | boolean;
  sourceId?: string;
  location?: SourceLocation;
  evidenceClass: EvidenceClass;
}

export interface FixOperation {
  id: string;
  path: string;
  kind: 'json-delete' | 'json-set' | 'text-replace' | 'copy';
  parser: ParserName;
  selector?: string;
  beforeHash: string;
  beforeBytes: number;
  afterText?: string;
  replacement?: string;
  lineEnding: 'lf' | 'crlf' | 'mixed';
  description: string;
}

export interface FixPrecondition {
  path: string;
  contentHash: string;
}

export interface FixPostcondition {
  description: string;
  paths: string[];
  ruleIds?: string[];
}

export interface FixPlan {
  id: string;
  findingIds: string[];
  safety: FixSafety;
  operations: FixOperation[];
  preconditions: FixPrecondition[];
  postconditions: FixPostcondition[];
  affectedPaths: string[];
  preview: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  doctor: 'context' | 'rules' | 'mcp' | 'hooks' | 'security' | 'internal' | 'benchmark' | 'baseline';
  severity: Severity;
  evidenceClass: EvidenceClass;
  confidence: Confidence;
  title: string;
  summary: string;
  impact: string;
  evidence: EvidenceItem[];
  locations: SourceLocation[];
  remediation: string;
  references: string[];
  applicable: boolean;
  observed: boolean;
  scoreEligible: boolean;
  scoreImpact: number;
  fixSafety: FixSafety;
  fixIds: string[];
  precisionStatus?: PrecisionStatus;
}

export interface InternalDiagnostic {
  id: string;
  phase: 'discovery' | 'parse' | 'resolve' | 'check' | 'report' | 'probe' | 'fix' | 'baseline' | 'benchmark';
  message: string;
  sourceId?: string;
  harness?: HarnessId;
  recoverable: boolean;
}

export interface CoverageEntry {
  harness: HarnessId;
  detected: boolean;
  parsed: boolean;
  precedenceModeled: boolean;
  runtimeProbed: boolean;
  behaviorObserved: boolean;
  gaps: CoverageGap[];
}

export interface Summary {
  bySeverity: Record<Severity, number>;
  byDoctor: Record<string, number>;
  applicable: number;
  observed: number;
  unscored: number;
  healthIndex?: number;
  deductions: Array<{ ruleId: string; doctor: string; amount: number; capped: boolean }>;
}

export interface PrivacySummary {
  redacted: boolean;
  valuesSerialized: false;
  networkRequests: number;
  childProcesses: number;
  notes: string[];
}

export interface ScanReport {
  schemaVersion: 1;
  tool: { name: 'harness-medic'; version: string };
  scan: { id: string; startedAt: string; durationMs: number; tier: ScanTier };
  workspace: string;
  privacy: PrivacySummary;
  coverage: CoverageEntry[];
  environments: EffectiveEnvironment[];
  observations: Observation[];
  findings: Finding[];
  summary: Summary;
  fixPlans: FixPlan[];
  internalDiagnostics: InternalDiagnostic[];
}

export interface ParsedSource {
  source: ConfigSource;
  value: unknown;
  content: string;
  bytes: number;
  newline: 'lf' | 'crlf' | 'mixed';
  finalNewline: boolean;
}

export interface AdapterDetection {
  installed: boolean;
  configured: boolean;
  evidence: string[];
}

export interface ProbeCapabilities {
  mcpList: 'supported' | 'unsupported';
  hookSynthetic: 'supported' | 'unsupported';
  transcripts: 'supported' | 'unsupported';
  compactionBenchmark: 'supported' | 'unsupported';
  subagents: 'supported' | 'unsupported';
}

export interface ActiveProbeRequest {
  server: McpServer;
  timeoutMs: number;
  retries: number;
  allowNetwork: boolean;
  signal?: AbortSignal;
}

export interface HarnessAdapter {
  id: HarnessId;
  version: string;
  detect(context: ScanContext, services: ScanServices): Promise<AdapterDetection>;
  discover(context: ScanContext, services: ScanServices): Promise<ConfigSource[]>;
  parse(source: ConfigSource, context: ScanContext, services: ScanServices): Promise<ParsedSource>;
  resolve(parsedSources: ParsedSource[], context: ScanContext, services: ScanServices): Promise<EffectiveEnvironment>;
  probeCapabilities(): ProbeCapabilities;
  activeProbe?(request: ActiveProbeRequest, context: ScanContext, services: ScanServices): Promise<Observation>;
}

export interface CheckServices {
  resolveExecutable(command: string, cwd: string): Promise<string | undefined>;
  now(): Date;
  envNames: string[];
  fs?: FileSystem;
  platform?: NodeJS.Platform;
  scanTier?: ScanTier;
}

export interface CheckDefinition {
  id: string;
  doctor: Finding['doctor'];
  defaultSeverity: Severity;
  evidenceClass: EvidenceClass;
  scoreEligible: boolean;
  references: string[];
  applicableHarnesses?: HarnessId[];
  scanTier?: ScanTier;
  requiredEvidence?: EvidenceClass[];
  run(environment: EffectiveEnvironment, services: CheckServices): Promise<Finding[]> | Finding[];
}

export const severityRank: Record<Severity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export const confidenceRank: Record<Confidence, number> = {
  certain: 0,
  high: 1,
  medium: 2,
  low: 3,
};