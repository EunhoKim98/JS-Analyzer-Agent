# JS Analyzer Agent

Multi-agent JavaScript vulnerability analyzer. See [`DESIGN.md`](./DESIGN.md) for the full architecture.

This repo is at **milestone v0.1**: deterministic static pre-pass → LLM OODA analysis → FP judge → HTML/JSON report, CLI only.

## Pipeline (v0.1)

```
[0] ingest      file / dir / url  → content-hash
[1] unbundle    sourcemap reconstruct, else beautify (deterministic)
[2] static      AST sink/source/sanitizer detection + heuristic taint + assets/secrets (no LLM)
[5] analyze     Sonnet, one OODA round per ranked sink        (needs API key)
[7] judge       Opus FP judge + deterministic recheck          (needs API key)
[8] report      report.html + assets_export.json
```

Later milestones (explore/asset/chaining agents, active PoC verification, Burp
extension, Claude Code wrapper) are specified in `DESIGN.md` but not yet built.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# deterministic static analysis only — no API calls, runs anywhere
npx tsx src/cli.ts analyze samples/vulnerable.js --no-llm

# full pipeline (static + LLM analysis + FP judge) — needs credentials (see Auth)
npx tsx src/cli.ts analyze samples/vulnerable.js

# or via the built binary
node dist/cli.js analyze <file|dir|url> [--no-llm] [--max-sinks K] [--config path] [--out dir]

# page discovery: a non-.js URL is loaded in headless chromium and its JS
# (external scripts + inline + dynamically injected) is discovered, then analyzed
node dist/cli.js analyze https://example.com --no-llm
node dist/cli.js analyze https://example.com --all-hosts      # include third-party JS
node dist/cli.js analyze https://cdn.example.com/app.js       # single .js URL → fetched directly
```

## Acquisition (where the JS comes from)

Per DESIGN.md §4.11, the analysis front-end differs by surface:

- **CLI / Claude Code** — a page URL is loaded in **headless chromium (Playwright)**;
  external scripts (network), inline `<script>`, and dynamically injected JS are
  collected. Default scope = same site (`--scope h1,h2` to add hosts, `--all-hosts`
  for third-party). A `.js` URL is fetched directly; `--browser` / `--no-browser`
  force the mode.
- **Burp extension** (later milestone) — filters in-scope JS responses from proxy traffic.

Requires a one-time `npx playwright install chromium`.

## Auth

The LLM stages accept **either** an API key **or** a Claude subscription OAuth token.
Resolution order (first match wins):

1. `ANTHROPIC_API_KEY` — Anthropic API key (pay-per-use).
2. `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_AUTH_TOKEN` — Claude Pro/Max OAuth token.
3. `~/.claude/.credentials.json` — auto-detected after `claude login` (Windows/Linux).

```powershell
# API key
$env:ANTHROPIC_API_KEY="sk-ant-..."
# or OAuth token (e.g. from `claude setup-token`)
$env:CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

OAuth support is best-effort: it sends the `anthropic-beta: oauth-2025-04-20` header
(override with `ANTHROPIC_OAUTH_BETA`) and a Claude Code identity system block. If the
API rejects the token, fall back to an API key. macOS Keychain-stored credentials are
not auto-read — export a token instead.

Output lands in `runs/<run_id>/` — `sinks.json`, `asset_manifest.json`,
`findings.jsonl`, `verdicts.json`, `assets_export.json`, `report.html`, plus
per-agent `trace/` logs.

## Config

`js-analyzer.config.json` (models, `maxSinks` budget, concurrency, temperature).
Model IDs default to `claude-sonnet-5` (analyze) and `claude-opus-4-8` (judge);
override there if your account uses different IDs.

## Coverage

Vulnerability classes are data-driven rule cards in `rules/*.yaml` (DESIGN.md §15).
v0.1 seeds: DOM-XSS, open redirect, postMessage (missing origin check),
prototype pollution (heuristic), and hardcoded secrets (with public-key
classification). Add a class = add a rule card.
