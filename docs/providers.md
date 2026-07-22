---
title: LLM Provider 선택
nav_order: 3
description: 결정론 파이프라인은 그대로, LLM 호출 단계만 SDK / Claude Code / Codex 로 교체.
---

# LLM Provider 선택
{: .no_toc }

결정론 파이프라인은 그대로 두고, **LLM 호출 단계의 백엔드만** 갈아끼웁니다. 사내망 인증 환경에 맞춰
API 게이트웨이·구독 CLI·타 벤더를 선택할 수 있습니다.
{: .fs-5 .fw-300 }

1. TOC
{:toc}

---

## 왜 선택형인가

analyze·judge 단계는 **스키마 검증된 JSON**을 요구합니다. 이 계약만 지키면 실제로 어떤 백엔드가
호출을 처리하는지는 무관합니다. 그래서 `LlmProvider` 인터페이스 하나로 추상화하고, 구현체를 교체합니다.

| Provider | 구현 | 인증/설정 |
|---|---|---|
| **sdk** (기본) | Anthropic/OpenAI 호환 HTTP | `ANTHROPIC_BASE_URL`(사내 게이트웨이) + 토큰. Burp 확장에서는 UI에 **URL·토큰 입력** |
| **claude-cli** | `claude -p "<prompt>"` shell out | 로컬 `claude` 로그인(구독/토큰) 사용 |
| **codex** | `codex exec "<prompt>"` shell out | 로컬 `codex` 로그인 사용 |

## 검증됨 (R1)

CLI provider가 결정론 파이프라인의 JSON 계약을 지킬 수 있는지가 관건이었습니다. `claude -p`에 실제
analyze 프롬프트를 넣어 **3/3 스키마 통과**, DOM-XSS를 정확히 탐지하고 PoC까지 반환함을 실측했습니다.

```json
{ "verdict": "vulnerable", "confidence": 0.97,
  "taint_path": ["location.search", "document.write"],
  "poc": { "type": "url", "payload": "…", "destructive": false },
  "reasoning": "location.search가 새니타이저 없이 document.write로 흘러 DOM-XSS." }
```

## 선택 방법

```bash
# CLI 플래그
node dist/cli.js analyze <target> --provider sdk
node dist/cli.js analyze <target> --provider claude-cli
node dist/cli.js analyze <target> --provider codex
```

또는 `js-analyzer.config.json`의 `provider` 필드로 기본값을 지정합니다. Burp 확장에서는 탭 UI의
드롭다운으로 고르고, `sdk` 선택 시 base URL·토큰 필드가 활성화됩니다.

## degrade 계약

어떤 provider든 호출이 실패하면 예외를 던지지 않고 `null`을 반환합니다. 그러면 파이프라인은 정적 폴백
(`uncertain`)이나 `needs_review`로 이어가며 죽지 않습니다. 재현성을 위해 대상 모델에는 temperature를 보내지 않습니다.
