import { CliProvider } from './cli-base';
import { ProviderKind } from '../provider';

// Claude Code provider — 로컬 `claude -p "<prompt>"` (비대화 print 모드)로 shell out.
// 사용자의 로컬 claude 로그인(구독/토큰)을 그대로 사용한다. R1에서 검증됨.
export class ClaudeCliProvider extends CliProvider {
  readonly kind: ProviderKind = 'claude-cli';
  protected readonly command = 'claude';
  protected args(prompt: string): string[] {
    return ['-p', prompt];
  }
}
