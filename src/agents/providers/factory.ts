import { LlmProvider, ProviderKind } from '../provider';
import { AuthResolver, LlmClient } from '../client';
import { ClaudeCliProvider } from './claude-cli';
import { CodexProvider } from './codex';

export { CliProvider } from './cli-base';
export { ClaudeCliProvider } from './claude-cli';
export { CodexProvider } from './codex';

// provider 팩토리 — 설정에서 고른 종류에 맞는 LlmProvider 를 생성한다.
// 합성 루트에서만 호출해 provider 선택 로직을 한곳에 모은다(D4).
export function createLlmProvider(kind: ProviderKind, auth: AuthResolver): LlmProvider {
  switch (kind) {
    case 'claude-cli':
      return new ClaudeCliProvider();
    case 'codex':
      return new CodexProvider();
    case 'sdk':
    default:
      return new LlmClient(auth);
  }
}
