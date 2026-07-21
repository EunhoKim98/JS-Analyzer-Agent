import { z } from 'zod';
import { SinkRecord, Finding, RuleCard } from '../types';
import { Agent, LlmAgent } from './agent';
import { ANALYZE_SYSTEM, analyzeUser } from './prompts';

const AnalyzeSchema = z.object({
  verdict: z.enum(['vulnerable', 'not_vulnerable', 'uncertain']),
  confidence: z.number().min(0).max(1),
  taint_path: z.array(z.string()),
  assumed_input: z.string().optional(),
  poc: z
    .object({
      type: z.enum(['browser', 'http', 'url']),
      payload: z.string(),
      target: z.string().optional(),
      expected: z.string().optional(),
      destructive: z.boolean(),
    })
    .nullable()
    .optional(),
  reasoning: z.string(),
});

// 분석 에이전트에 넘기는 입력 묶음(파라미터 객체) — 인자 나열 대신 하나의 값으로.
export interface AnalyzeInput {
  sink: SinkRecord;
  slice: string;
  card?: RuleCard;
}

// Stage [5]: 후보 싱크 하나에 대해 OODA 한 라운드를 수행하는 에이전트(Sonnet).
export class AnalyzeAgent extends LlmAgent implements Agent<AnalyzeInput, Finding> {
  readonly name = 'analyze';

  async run({ sink, slice, card }: AnalyzeInput): Promise<Finding> {
    const ruleSummary = card ? JSON.stringify(card) : `class: ${sink.class}`;
    const result = await this.llm.callJSON({
      model: this.config.models.analyze,
      system: ANALYZE_SYSTEM,
      user: analyzeUser(sink, slice, ruleSummary),
      schema: AnalyzeSchema,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokensPerCall,
      onTrace: (rec) => this.store.trace('analyze', { sink_id: sink.id, ...(rec as object) }),
    });

    if (!result) {
      // Degrade: keep the static finding as uncertain when the LLM call fails.
      return AnalyzeAgent.staticFallback(sink, 'analyzer call failed');
    }

    return {
      id: sink.id.replace(/^sink_/, 'find_'),
      sink_id: sink.id,
      class: sink.class,
      verdict: result.verdict,
      confidence: result.confidence,
      evidence: {
        taint_path: result.taint_path,
        assumed_input: result.assumed_input,
        recheck_assert: `sink ${sink.sink.api} present at ${sink.sink.file}:${sink.sink.line}`,
        poc: result.poc ?? undefined,
        file: sink.sink.file,
        span: sink.sink.span,
      },
      reasoning: result.reasoning,
    };
  }

  // 정적 폴백 — LLM 미사용/실패 시 정적 싱크를 "uncertain" 소견으로 보존한다.
  static staticFallback(sink: SinkRecord, reason: string): Finding {
    return {
      id: sink.id.replace(/^sink_/, 'find_'),
      sink_id: sink.id,
      class: sink.class,
      verdict: 'uncertain',
      confidence: sink.path_grade === 'direct' ? 0.5 : 0.3,
      evidence: {
        taint_path: [sink.source.kind || 'unknown-source', sink.sink.api],
        recheck_assert: `sink ${sink.sink.api} present at ${sink.sink.file}:${sink.sink.line}`,
        file: sink.sink.file,
        span: sink.sink.span,
      },
      reasoning: `static-only (${reason})`,
    };
  }
}
