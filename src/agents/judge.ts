import { z } from 'zod';
import { Finding, Verdict, JsAnalConfig } from '../types';
import { callJSON } from './client';
import { JUDGE_SYSTEM, judgeUser } from './prompts';
import { RunStore } from '../orchestrator/store';

const JudgeSchema = z.object({
  exploitable: z.boolean(),
  reason: z.string(),
});

// Deterministic recheck: re-confirm the sink token is present at the finding's
// location (DESIGN.md §7 — kills "pattern doesn't exist" false positives).
export function deterministicRecheck(finding: Finding, fileCode: string): boolean {
  const lines = fileCode.split('\n');
  const line = finding.evidence.span[0];
  const window = lines.slice(Math.max(0, line - 2), line + 1).join('\n');
  const token = coreToken(finding.evidence.recheck_assert, finding.class);
  return token ? window.includes(token) : false;
}

function coreToken(assert: string, cls: string): string {
  // recheck_assert format: `sink <api> present at <file>:<line>`.
  // Take the LAST identifier of the api (the method/property name) — robust to
  // apis with dots, parens, quotes, or spaces (e.g. "addEventListener('message')",
  // "<obj>.innerHTML", "for-in merge").
  const m = assert.match(/sink (.+?) present at/);
  const api = m ? m[1] : '';
  const ids = api.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
  if (ids.length) return ids[ids.length - 1];
  if (cls === 'dom-xss') return 'innerHTML';
  return '';
}

// Stage [7]: FP judge (Opus) + deterministic recheck → verdict.
export async function judgeFinding(
  finding: Finding,
  slice: string,
  fileCode: string,
  config: JsAnalConfig,
  store: RunStore,
): Promise<Verdict> {
  const recheck = deterministicRecheck(finding, fileCode);

  const result = await callJSON({
    model: config.models.judge,
    system: JUDGE_SYSTEM,
    user: judgeUser(finding, slice),
    schema: JudgeSchema,
    temperature: config.temperature,
    maxTokens: config.maxTokensPerCall,
    onTrace: (rec) => store.trace('judge', { finding_id: finding.id, ...(rec as object) }),
  });

  if (!result) {
    return {
      finding_id: finding.id,
      status: 'needs_review',
      deterministic_recheck: recheck,
      judge_verdict: 'unknown',
      reason: 'judge call failed — routed to human review',
    };
  }

  let status: Verdict['status'];
  if (!recheck) status = 'needs_review';
  else if (result.exploitable) status = 'confirmed';
  else status = 'rejected';

  return {
    finding_id: finding.id,
    status,
    deterministic_recheck: recheck,
    judge_verdict: result.exploitable ? 'exploitable' : 'not-exploitable',
    reason: result.reason,
  };
}
