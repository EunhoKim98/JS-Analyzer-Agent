// Shared types — the agent hand-off contracts (DESIGN.md §8).

export type VulnClass =
  | 'dom-xss'
  | 'proto-pollution'
  | 'open-redirect'
  | 'postmessage'
  | 'secret'
  | string;

export type PathGrade = 'direct' | 'aliased' | 'sink_only';
export type SeverityHint = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SinkRecord {
  id: string;
  class: VulnClass;
  sink: {
    api: string;
    file: string;
    line: number;
    span: [number, number];
    snippet: string;
  };
  source: { found: boolean; kind?: string; hops?: number };
  sanitizer: { found: boolean; kind?: string };
  path_grade: PathGrade;
  severity_hint: SeverityHint;
}

export interface AssetRecord {
  type: 'path' | 'api' | 'param' | 'secret';
  value: string;
  file: string;
  line: number;
  // secret-only
  secretKind?: string;
  classification?: 'sensitive' | 'public';
}

export interface LibVuln {
  severity: string;
  cve: string[];
  summary?: string;
  info: string[];
  ranges: string;
}

export interface LibraryFinding {
  component: string;
  version: string;
  file: string;
  vulnerabilities: LibVuln[];
}

export interface PoC {
  type: 'browser' | 'http' | 'url';
  payload: string;
  target?: string;
  expected?: string;
  destructive: boolean;
}

export interface Finding {
  id: string;
  sink_id: string;
  class: VulnClass;
  verdict: 'vulnerable' | 'not_vulnerable' | 'uncertain';
  confidence: number;
  evidence: {
    taint_path: string[];
    assumed_input?: string;
    recheck_assert: string;
    poc?: PoC;
    file: string;
    span: [number, number];
  };
  reasoning?: string;
}

export interface Verdict {
  finding_id: string;
  status: 'confirmed-active' | 'confirmed' | 'needs_review' | 'rejected';
  deterministic_recheck: boolean;
  judge_verdict: string;
  active_verified?: boolean;
  active_evidence?: string;
  reason: string;
}

// A rule card loaded from rules/*.yaml (DESIGN.md §15).
export interface RuleCard {
  class: VulnClass;
  severity: SeverityHint;
  detector: 'sink-flow' | 'proto-pollution' | 'postmessage' | 'regex';
  sinks?: {
    properties?: string[];
    calls?: string[];
    guardedCalls?: string[];
    memberCalls?: string[];
  };
  sources?: { memberPaths?: string[]; eventProps?: string[] };
  sanitizers?: { calls?: string[]; properties?: string[] };
  dangerousKeys?: string[];
  originChecks?: string[];
  patterns?: Array<{
    name: string;
    regex: string;
    classification: 'sensitive' | 'public';
  }>;
}

export interface JsAnalConfig {
  models: { analyze: string; judge: string };
  maxSinks: number;
  analyzeVendorSinks: boolean; // false = vendor/library files go the CVE route, not per-sink LLM
  concurrency: number;
  temperature: number;
  maxTokensPerCall: number;
  active: {
    enabled: boolean;
    proxy: string | null;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    scope: string[];
  };
}

export interface IngestedFile {
  file: string; // logical name
  code: string; // normalized/beautified source
  origin: 'raw' | 'sourcemap' | 'beautified';
  contentHash: string;
}
