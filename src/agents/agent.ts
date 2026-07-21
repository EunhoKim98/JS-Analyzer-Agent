import { LlmClient } from './client';
import { JsAnalConfig } from '../types';
import { RunStore } from '../orchestrator/store';

// 에이전트 공통 계약 — 모든 LLM 에이전트는 하나의 입력을 하나의 출력으로 변환한다.
// 파이프라인은 이 인터페이스에만 의존하므로(다형성) 에이전트 종류가 늘어도
// 오케스트레이터 코드는 바뀌지 않는다(OCP·LSP).
export interface Agent<In, Out> {
  readonly name: string;
  run(input: In): Promise<Out>;
}

// LLM 에이전트 공통 베이스 — 클라이언트·설정·추적 저장소를 주입받아 보관한다.
// (공통 협력자를 한 곳에 모아 중복 생성자 코드를 제거; DIP)
export abstract class LlmAgent {
  constructor(
    protected readonly llm: LlmClient,
    protected readonly config: JsAnalConfig,
    protected readonly store: RunStore,
  ) {}
}
