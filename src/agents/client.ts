import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

export type AuthMode = 'api' | 'oauth' | 'none';

interface ResolvedAuth {
  mode: AuthMode;
  token?: string;
  source?: string;
}

// OAuth (subscription) tokens are accepted by the Messages API only with this
// beta header and a Claude Code identity system block. Overridable via env in
// case Anthropic bumps the beta version.
const OAUTH_BETA = process.env.ANTHROPIC_OAUTH_BETA || 'oauth-2025-04-20';
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

let cachedAuth: ResolvedAuth | null = null;

export function resolveAuth(): ResolvedAuth {
  if (cachedAuth) return cachedAuth;

  if (process.env.ANTHROPIC_API_KEY) {
    cachedAuth = { mode: 'api', token: process.env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' };
    return cachedAuth;
  }
  const oauthEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
  if (oauthEnv) {
    cachedAuth = {
      mode: 'oauth',
      token: oauthEnv,
      source: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_AUTH_TOKEN',
    };
    return cachedAuth;
  }
  const stored = readClaudeOAuth();
  if (stored) {
    cachedAuth = { mode: 'oauth', token: stored, source: '~/.claude/.credentials.json' };
    return cachedAuth;
  }
  cachedAuth = { mode: 'none' };
  return cachedAuth;
}

// Read the OAuth access token Claude Code stores after `claude login`
// (Windows/Linux JSON file; macOS keeps it in the Keychain, not read here).
function readClaudeOAuth(): string | null {
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

export function hasAuth(): boolean {
  return resolveAuth().mode !== 'none';
}

export function describeAuth(): string {
  const a = resolveAuth();
  if (a.mode === 'none') return 'no credentials';
  return `${a.mode} (${a.source})`;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const auth = resolveAuth();
  if (auth.mode === 'oauth') {
    client = new Anthropic({
      authToken: auth.token,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA },
    });
  } else {
    client = new Anthropic({ apiKey: auth.token });
  }
  return client;
}

export interface CallOpts<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature: number;
  maxTokens: number;
  retries?: number;
  onTrace?: (rec: unknown) => void;
}

// Strict-JSON agent call: temperature-0, validate against a zod schema, retry
// with error feedback on malformed output (DESIGN.md §4.9). Returns null on
// terminal failure so the pipeline degrades instead of dying.
export async function callJSON<T>(opts: CallOpts<T>): Promise<T | null> {
  const retries = opts.retries ?? 3;
  const oauth = resolveAuth().mode === 'oauth';
  // OAuth tokens require the Claude Code identity as the first system block.
  const system: string | Anthropic.TextBlockParam[] = oauth
    ? [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, { type: 'text', text: opts.system }]
    : opts.system;

  let lastErr = '';
  for (let attempt = 0; attempt < retries; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nYour previous reply was invalid (${lastErr}). Return ONLY valid JSON matching the schema, no prose.`;
    try {
      const resp = await getClient().messages.create({
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
      // Non-retryable request errors (prompt too long, bad request) won't succeed
      // on retry — fail fast instead of burning 3 attempts.
      if (/too long|invalid_request_error|\b400\b/.test(lastErr)) break;
      await sleep(500 * (attempt + 1));
    }
  }
  console.error(`[agent] giving up after ${retries} attempts: ${lastErr}`);
  return null;
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
