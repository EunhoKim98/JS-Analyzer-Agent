---
title: 사용법
nav_order: 6
description: 설치, CLI, 인증, 출력.
---

# 사용법
{: .no_toc }

1. TOC
{:toc}

---

## 설치 & 빌드

```bash
git clone https://github.com/EunhoKim98/JS-Analyzer-Agent.git
cd JS-Analyzer-Agent
npm install
npm run build
```

> 브라우저 설치가 필요 없습니다 — Playwright/헤드리스 크로미움은 제거되어(D7) 코어는 완전 자기완결입니다.

## 분석 (CLI)

```bash
# 정적 분석만 — API 호출 없이 어디서든 실행
npx tsx src/cli.ts analyze samples/vulnerable.js --no-llm

# 전체 파이프라인 (정적 + LLM 분석 + 오탐 판정)
npx tsx src/cli.ts analyze samples/vulnerable.js

# LLM 백엔드 선택
node dist/cli.js analyze <target> --provider sdk|claude-cli|codex

# 직접 .js URL → 원문 fetch 후 분석 (자동 크롤링·페이지 렌더 없음, D7)
node dist/cli.js analyze https://example.com/app.js --no-llm

# 디렉터리 전체 분석
node dist/cli.js analyze ./dist --no-llm
```

옵션: `--no-llm`, `--provider <p>`, `--max-sinks <K>`, `--config <path>`, `--out <dir>`.
페이지 전체의 JS가 필요하면 [Burp 확장]({{ '/burp.html' | relative_url }}) 시드를 사용합니다(D7).

## 로컬 HTTP 서버 (Burp 확장용)

```bash
node dist/cli.js serve --port 8787 --host 127.0.0.1 [--token T]
# POST /jobs · GET /jobs/:id · GET /jobs/:id/report · GET /health
```

## 인증

LLM 단계는 아래 순서로 자격증명을 찾습니다 (SDK provider 기준). 먼저 매칭되는 것이 사용됩니다.

| 순서 | 출처 | 비고 |
|---|---|---|
| 1 | `ANTHROPIC_API_KEY` | Anthropic API 키 (사용량 과금) |
| 2 | `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` | Claude Pro/Max 구독 OAuth 토큰 |
| 3 | `~/.claude/.credentials.json` | `claude login` 후 자동 감지 (Windows/Linux) |

사내 게이트웨이는 `ANTHROPIC_BASE_URL`로 엔드포인트를 교체합니다. `claude-cli`·`codex` provider는
로컬 CLI 로그인을 그대로 사용하므로 위 자격증명이 필요 없습니다.

## 출력

`runs/<run_id>/`에 `report.html`(사람용) + `assets_export.json`·`findings.jsonl`·`verdicts.json`·`meta.json`
(기계용) + 에이전트 `trace/` 로그가 남습니다.

## 설정

`js-analyzer.config.json` — `provider`, `models`, `maxSinks` 예산, 동시성, `analyzeVendorSinks` 등.
