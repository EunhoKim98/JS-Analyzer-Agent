import { z } from 'zod';
import { Finding, Verdict } from '../types';
import { Agent, LlmAgent } from './agent';
import { JUDGE_SYSTEM, judgeUser } from './prompts';

const JudgeSchema = z.object({
  exploitable: z.boolean(),
  reason: z.string(),
});

// 결정론적 재확인기 — 소견 위치에 싱크 토큰이 실제로 존재하는지 텍스트로 재확인한다
// (DESIGN.md §7 — "패턴이 존재하지 않는" 종류의 거짓양성을 제거). 상태·의존성이 없는
// 순수 판정이므로 정적 메서드로만 노출한다.
export class DeterministicRecheck {
  static check(finding: Finding, fileCode: string): boolean {
    const lines = fileCode.split('\n');
    const line = finding.evidence.span[0];
    const window = lines.slice(Math.max(0, line - 2), line + 1).join('\n');
    const token = DeterministicRecheck.coreToken(finding.evidence.recheck_assert, finding.class);
    return token ? window.includes(token) : false;
  }

  private static coreToken(assert: string, cls: string): string {
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
}

// 판정 에이전트에 넘기는 입력 묶음(파라미터 객체).
export interface JudgeInput {
  finding: Finding;
  slice: string;
  fileCode: string;
}

// Stage [7]: 독립적 거짓양성 판정(Opus) + 결정론적 재확인 → 최종 verdict.
export class JudgeAgent extends LlmAgent implements Agent<JudgeInput, Verdict> {
  readonly name = 'judge';

  async run({ finding, slice, fileCode }: JudgeInput): Promise<Verdict> {
    const recheck = DeterministicRecheck.check(finding, fileCode);

    const result = await this.llm.callJSON({
      model: this.config.models.judge,
      system: JUDGE_SYSTEM,
      user: judgeUser(finding, slice),
      schema: JudgeSchema,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokensPerCall,
      onTrace: (rec) => this.store.trace('judge', { finding_id: finding.id, ...(rec as object) }),
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
}
