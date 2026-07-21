import { z } from 'zod';

export type ProviderKind = 'sdk' | 'claude-cli' | 'codex';

// 엄격-JSON LLM 호출 옵션 — provider 종류에 무관한 공통 계약.
export interface CallOpts<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature: number;
  maxTokens: number;
  retries?: number;
  onTrace?: (rec: unknown) => void;
}

// LLM provider 인터페이스(Strategy) — 결정론 파이프라인은 이 인터페이스에만 의존한다.
// 구현체: SDK(HTTP, URL+토큰) / Claude Code(`claude -p`) / Codex(`codex exec`).
// 모두 스키마 검증된 T를 반환하거나, 종단 실패 시 null을 반환해 파이프라인이
// 죽지 않고 degrade 하도록 한다(DESIGN.md §4.9). R1 실험으로 CLI provider도 이
// 계약을 지킬 수 있음을 확인함.
export interface LlmProvider {
  readonly kind: ProviderKind;
  callJSON<T>(opts: CallOpts<T>): Promise<T | null>;
}
