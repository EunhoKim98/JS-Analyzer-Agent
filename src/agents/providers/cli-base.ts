import { execFile } from 'child_process';
import { LlmProvider, CallOpts, ProviderKind } from '../provider';
import { extractJson } from '../../util/json';

// CLI provider 베이스 — 로컬 에이전트 CLI(`claude -p`, `codex exec`)에 프롬프트를
// 넘기고 stdout에서 스키마 JSON을 뽑는 공통 재시도 루프를 구현한다. R1 실험으로
// `claude -p`가 프로즈 없는 스키마 JSON을 안정적으로 반환함을 확인함(3/3).
// SDK provider와 동일한 "실패 시 null → degrade" 계약을 지킨다(DESIGN.md §4.9).
export abstract class CliProvider implements LlmProvider {
  abstract readonly kind: ProviderKind;
  protected abstract readonly command: string;
  protected abstract args(prompt: string): string[];

  constructor(protected readonly timeoutMs = 120_000) {}

  async callJSON<T>(opts: CallOpts<T>): Promise<T | null> {
    const retries = opts.retries ?? 3;
    let lastErr = '';
    for (let attempt = 0; attempt < retries; attempt++) {
      const user =
        attempt === 0
          ? opts.user
          : `${opts.user}\n\nYour previous reply was invalid (${lastErr}). Return ONLY valid JSON matching the schema, no prose.`;
      // CLI has no separate system channel — prepend the system block.
      const prompt = `${opts.system}\n\n${user}`;
      try {
        const out = await this.exec(prompt);
        opts.onTrace?.({ attempt, provider: this.kind, response: out });
        const parsed = opts.schema.safeParse(extractJson(out));
        if (parsed.success) return parsed.data;
        lastErr = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      } catch (e) {
        lastErr = (e as Error).message;
        opts.onTrace?.({ attempt, error: lastErr });
        // Missing binary / auth failures won't fix on retry — fail fast.
        if (/ENOENT|not found|unauthorized|login/i.test(lastErr)) break;
      }
    }
    console.error(`[agent:${this.kind}] giving up after ${retries} attempts: ${lastErr}`);
    return null;
  }

  private exec(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.command,
        this.args(prompt),
        { timeout: this.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
  }
}
