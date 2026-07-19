import { z } from 'zod';
import { SinkRecord, Finding, RuleCard, JsAnalConfig } from '../types';
import { callJSON } from './client';
import { ANALYZE_SYSTEM, analyzeUser } from './prompts';
import { RunStore } from '../orchestrator/store';

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

// Stage [5]: one OODA round per candidate sink (Sonnet).
export async function analyzeSink(
  sink: SinkRecord,
  slice: string,
  card: RuleCard | undefined,
  config: JsAnalConfig,
  store: RunStore,
): Promise<Finding> {
  const ruleSummary = card ? JSON.stringify(card) : `class: ${sink.class}`;
  const result = await callJSON({
    model: config.models.analyze,
    system: ANALYZE_SYSTEM,
    user: analyzeUser(sink, slice, ruleSummary),
    schema: AnalyzeSchema,
    temperature: config.temperature,
    maxTokens: config.maxTokensPerCall,
    onTrace: (rec) => store.trace('analyze', { sink_id: sink.id, ...(rec as object) }),
  });

  if (!result) {
    // Degrade: keep the static finding as uncertain when the LLM call fails.
    return staticFallback(sink, 'analyzer call failed');
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

export function staticFallback(sink: SinkRecord, reason: string): Finding {
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
