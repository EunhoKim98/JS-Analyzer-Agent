import { JsAnalConfig, IngestedFile, SinkRecord, AssetRecord, LibraryFinding, Finding, Verdict } from '../types';
import { RunStore } from './store';
import { AssetsExport } from '../report/json';

// Burp history 등 외부에서 넘어온 JS 시드 (URL/경로 + 본문). 이 시드가 분석 입력의
// 전부이며 별도 브라우저 수집은 하지 않는다(D7). name은 보통 URL/경로.
export interface SeedFile {
  name: string;
  code: string;
}

// 파이프라인 실행 옵션 — CLI 인자 또는 HTTP 잡 본문에서 넘어온다.
export interface RunOptions {
  target: string;
  configPath?: string;
  noLlm?: boolean;
  seedFiles?: SeedFile[]; // Burp history 등 외부 시드 JS (D7); 중복은 전처리에서 제거

  provider?: 'sdk' | 'claude-cli' | 'codex'; // LLM 백엔드 선택(D4), config.provider 오버라이드
  maxSinks?: number;
  baseDir?: string;
}

// 파이프라인 최종 결과 — CLI가 사용자에게 출력한다.
export interface RunResult {
  runId: string;
  dir: string;
  reportPath: string;
  meta: RunMeta;
}

// 파이프라인 스트리밍 이벤트(D8) — SSE로 흘려보내는 계약. finding·verdict는 finding_id로
// 상관되어, 라이브 페이지가 finding 행을 먼저 그리고 verdict 도착 시 그 행 상태를 갱신한다.
export type PipelineEvent =
  | { type: 'stage'; name: string }
  | { type: 'finding'; finding: Finding }
  | { type: 'verdict'; finding_id: string; status: Verdict['status']; verdict: Verdict }
  | { type: 'done'; meta: RunMeta }
  | { type: 'error'; message: string };

export interface RunMeta {
  target: string;
  runId: string;
  contentHash: string;
  timestamp: string;
  acquisition: string;
  files: Array<{ file: string; origin: string }>;
  llmUsed: boolean;
  auth: string;
  config: { maxSinks: number; models: { analyze: string; judge: string } };
  counts: Record<string, number>;
}

// 실행 컨텍스트(Context Object 패턴) — 스테이지들이 공유·누적하는 상태를 한 객체에 담는다.
// 각 스테이지는 이전 스테이지가 채운 필드를 읽고 자기 결과를 덧붙인다. 순수한 In→Out
// 체인 대신 컨텍스트를 쓰는 이유: 뒤 스테이지가 앞선 여러 스테이지의 산출물을 필요로 하기 때문.
export class RunContext {
  // set by the acquire stage
  runId!: string;
  store!: RunStore;
  contentHash = 'empty';
  raw: IngestedFile[] = [];
  acquisition = 'direct';
  targetDir?: string;

  // set by the unbundle stage
  files: IngestedFile[] = [];

  // set by the static stage
  sinks: SinkRecord[] = [];
  assets: AssetRecord[] = [];
  libraries: LibraryFinding[] = [];

  // set by the route stage
  useLlm = false;
  appSinks: SinkRecord[] = [];
  analyzeSet: SinkRecord[] = [];
  unanalyzed: SinkRecord[] = [];
  librarySkipped = 0;
  cveCount = 0;

  // set by the analyze / judge stages
  findings: Finding[] = [];
  verdicts: Record<string, Verdict> = {};

  // set by the report stage
  timestamp = '';
  assetsExport?: AssetsExport;
  reportPath = '';
  meta?: RunMeta;

  constructor(
    readonly opts: RunOptions,
    readonly config: JsAnalConfig,
    private readonly onEvent?: (e: PipelineEvent) => void,
  ) {}

  // 스트리밍 이벤트 방출(D8) — onEvent가 없으면 no-op(CLI 모드).
  emit(e: PipelineEvent): void {
    this.onEvent?.(e);
  }

  // Fast lookup of reconstructed code by logical file name (used by analyze/judge).
  codeByFile(): Map<string, string> {
    return new Map(this.files.map((f) => [f.file, f.code]));
  }
}
