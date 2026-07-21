import { CliProvider } from './cli-base';
import { ProviderKind } from '../provider';

// Codex provider — 로컬 `codex exec "<prompt>"`로 shell out. 사용자의 로컬 codex
// 로그인을 사용한다. `claude -p`와 동일 메커니즘(stdout에서 스키마 JSON 추출).
// R1은 claude-cli로만 검증했으므로 codex 출력 안정성은 최초 도입 시 실측 필요.
export class CodexProvider extends CliProvider {
  readonly kind: ProviderKind = 'codex';
  protected readonly command = 'codex';
  protected args(prompt: string): string[] {
    return ['exec', prompt];
  }
}
