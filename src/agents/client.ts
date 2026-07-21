import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LlmProvider, CallOpts } from './provider';
import { extractJson } from '../util/json';

export { CallOpts } from './provider';

export type AuthMode = 'api' | 'oauth' | 'none';

export interface ResolvedAuth {
  mode: AuthMode;
  token?: string;
  source?: string;
}

// OAuth (subscription) tokens are accepted by the Messages API only with this
// beta header and a Claude Code identity system block. Overridable via env in
// case Anthropic bumps the beta version.
const OAUTH_BETA = process.env.ANTHROPIC_OAUTH_BETA || 'oauth-2025-04-20';
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

// 인증 해석기 — 자격증명 출처(API 키 / OAuth 토큰 / 저장 파일)를 한곳에서 결정한다.
// 예전에는 모듈 전역 캐시(`cachedAuth`)였으나, 인스턴스 필드로 캡슐화해
// 전역 가변 상태를 제거하고 테스트 시 교체(주입) 가능하게 만들었다(SRP·DIP).
export class AuthResolver {
  private cached: ResolvedAuth | null = null;

  // Resolution order (first match wins): API key → OAuth env → stored credentials.
  resolve(): ResolvedAuth {
    if (this.cached) return this.cached;

    if (process.env.ANTHROPIC_API_KEY) {
      return (this.cached = {
        mode: 'api',
        token: process.env.ANTHROPIC_API_KEY,
        source: 'ANTHROPIC_API_KEY',
      });
    }
    const oauthEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
    if (oauthEnv) {
      return (this.cached = {
        mode: 'oauth',
        token: oauthEnv,
        source: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_AUTH_TOKEN',
      });
    }
    const stored = this.readClaudeOAuth();
    if (stored) {
      return (this.cached = { mode: 'oauth', token: stored, source: '~/.claude/.credentials.json' });
    }
    return (this.cached = { mode: 'none' });
  }

  hasAuth(): boolean {
    return this.resolve().mode !== 'none';
  }

  isOAuth(): boolean {
    return this.resolve().mode === 'oauth';
  }

  describe(): string {
    const a = this.resolve();
    return a.mode === 'none' ? 'no credentials' : `${a.mode} (${a.source})`;
  }

  // Read the OAuth access token Claude Code stores after `claude login`
  // (Windows/Linux JSON file; macOS keeps it in the Keychain, not read here).
  private readClaudeOAuth(): string | null {
    try {
      const p = path.join(os.homedir(), '.claude', '.credentials.json');
      if (!fs.existsSync(p)) return null;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const oauth = data.claudeAiOauth || data.oauth || data;
      const token = oauth?.accessToken || oauth?.access_token;
      if (!token) return null;
      const expiresAt = oauth.expiresAt || oauth.expires_at;
      if (expiresAt && Date.now() > Number(expiresAt)) {
        console.error('[auth] stored Claude OAuth token has expired — run `claude login` again');
        return null;
      }
      return token;
    } catch {
      return null;
    }
  }
}

// SDK provider — Anthropic Messages API 호출과 "엄격한 JSON" 계약을 캡슐화한다.
// AuthResolver 를 생성자 주입으로 받아(DIP) 인증 방식에 무관하게 동작하며,
// 실제 SDK 클라이언트는 지연 생성해 인스턴스에 보관한다(전역 싱글턴 제거).
// base URL·토큰은 SDK가 ANTHROPIC_BASE_URL/authToken 으로 읽으므로 사내 게이트웨이도 지원.
export class LlmClient implements LlmProvider {
  readonly kind = 'sdk' as const;
  private sdk: Anthropic | null = null;

  constructor(private readonly auth: AuthResolver) {}

  private client(): Anthropic {
    if (this.sdk) return this.sdk;
    const resolved = this.auth.resolve();
    this.sdk =
      resolved.mode === 'oauth'
        ? new Anthropic({ authToken: resolved.token, defaultHeaders: { 'anthropic-beta': OAUTH_BETA } })
        : new Anthropic({ apiKey: resolved.token });
    return this.sdk;
  }

  // Strict-JSON agent call: validate against a zod schema, retry with error
  // feedback on malformed output (DESIGN.md §4.9). Returns null on terminal
  // failure so the pipeline degrades instead of dying.
  async callJSON<T>(opts: CallOpts<T>): Promise<T | null> {
    const retries = opts.retries ?? 3;
    // OAuth tokens require the Claude Code identity as the first system block.
    const system: string | Anthropic.TextBlockParam[] = this.auth.isOAuth()
      ? [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, { type: 'text', text: opts.system }]
      : opts.system;

    let lastErr = '';
    for (let attempt = 0; attempt < retries; attempt++) {
      const user =
        attempt === 0
          ? opts.user
          : `${opts.user}\n\nYour previous reply was invalid (${lastErr}). Return ONLY valid JSON matching the schema, no prose.`;
      try {
        const resp = await this.client().messages.create({
          model: opts.model,
          max_tokens: opts.maxTokens,
          // NOTE: temperature is deprecated on the target models (Claude 5 /
          // Opus 4.8) — they reject it. Omitted; these models are effectively
          // deterministic at default, preserving run reproducibility.
          system,
          messages: [{ role: 'user', content: user }],
        });
        const text = resp.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n');
        opts.onTrace?.({ attempt, model: opts.model, response: text, usage: resp.usage });
        const parsed = opts.schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastErr = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      } catch (e) {
        lastErr = (e as Error).message;
        opts.onTrace?.({ attempt, error: lastErr });
        // Non-retryable request errors (prompt too long, bad request) won't
        // succeed on retry — fail fast instead of burning 3 attempts.
        if (/too long|invalid_request_error|\b400\b/.test(lastErr)) break;
        await this.sleep(500 * (attempt + 1));
      }
    }
    console.error(`[agent] giving up after ${retries} attempts: ${lastErr}`);
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
