---
title: 설계 문서 (Burp)
nav_order: 8
description: office-hours 설계 — single-JAR가 Node 코어를 번들, provider 선택형, Burp history 시드.
---

# 설계 문서 — Burp 확장 통합 (single-JAR, provider 선택형)
{: .no_toc }

작성: 2026-07-21 · 대상 마일스톤: v1.0 · 현재: v0.1
관련: DESIGN.md §4.1 / §10 / §18, CLAUDE.md

## 한 줄 요약

Burp Suite에 **JAR 하나만 설치**하면, 분석 대상을 고르는 순간 Burp history의 그 대상 JS를 시드로 가져오고, 빈틈은 Playwright로 채워 JS를 전부 확보한 뒤, 사용자가 고른 LLM provider(**SDK URL+토큰 / Claude Code / Codex**)로 진단을 수행해 Burp 탭에 결과를 렌더한다.

## 확정된 결정 (office-hours)

| # | 결정 | 근거 |
|---|---|---|
| D1 | provider 선택 = **LLM 백엔드/인증만 교체**, 결정론 파이프라인은 유지 | (A) 채택. static pre-pass가 이 툴의 차별점 |
| D2 | 산출물 = **JAR 하나** (별도 Node 서버 설치 없음) | 분석가는 버프에 JAR 하나만 설치 |
| D3 | 엔진 위치 = **JAR이 Node 코어를 번들** (Approach B) | 방금 리팩터한 TS/Babel 코어 보존 + 단일 설치 |
| D4 | provider 3종: SDK(=HTTP, URL+토큰 입력) / Claude Code(`claude -p`) / Codex(`codex exec`) | 사내망 토큰 유연성. 비-SDK는 CLI shell out |
| D5 | 시드 = Burp history의 **URL + 응답 본문(JS)**, Playwright는 빈틈만 | Burp=관측된 현실(인증 트래픽 포함), Playwright=능동 탐색 |
| D6 | 배포 = 버전별 JAR을 **GitHub Releases**에 CI로 업로드 | 사용자가 버전 골라 설치 |

## 아키텍처

```
┌──────────────────────── Burp Suite ────────────────────────┐
│  [JAR] Java Montoya 확장                                     │
│   · 우클릭 "Analyze JS" / 대상(호스트) 선택                    │
│   · Burp history·sitemap에서 대상 URL+JS 본문 수집             │
│   · provider 설정 UI (SDK URL+토큰 / Claude Code / Codex)     │
│   · 결과 탭 렌더 + 진행 폴링                                   │
│        │ 최초 실행 시 번들된 코어 바이너리 추출→spawn           │
│        │ localhost HTTP (잡 제출·폴링)                        │
│        ▼                                                     │
│  [번들 코어] Node 단일 바이너리 (JAR 리소스에 내장)            │
│   · POST /jobs (seed JS + provider 설정) → job_id            │
│   · Playwright 빈틈 수집 (BrowserDiscoverer)                  │
│   · 정적 pre-pass → analyze → judge (runPipeline)            │
│   · LlmProvider 전략으로 LLM 단계 실행                        │
│   · GET /jobs/:id, GET /jobs/:id/report                     │
└─────────────────────────────────────────────────────────────┘
```

## 컴포넌트와 책임

### 1) Java Montoya 확장 (`burp/`, 신규)
- **진입**: `BurpExtension` 구현, 우클릭 컨텍스트 메뉴 "Analyze JS" + 대상 선택.
- **시드 수집**: Montoya API `SiteMap`/proxy history에서 선택 대상 호스트의 응답 중 JS(콘텐츠 타입/확장자)만 필터해 URL + 본문 확보 (D5).
- **provider 설정 UI**: 드롭다운(SDK / Claude Code / Codex). SDK 선택 시 **base URL + 토큰 입력 필드** 노출. 비-SDK는 입력 없음(로컬 CLI 사용).
- **코어 생명주기**: 최초 실행 시 JAR 리소스에서 OS에 맞는 코어 바이너리 추출→임시 디렉터리→spawn. 종료 시 정리.
- **잡 제출/폴링/렌더**: 코어에 `POST /jobs`, 백그라운드 폴링, 완료 시 결과를 Burp 탭에 표(confirmed/needs_review/rejected + 자산/경로).

### 2) 번들 Node 코어 (기존 `src/` + 신규 `src/http/`, `src/agents/providers/`)
- **HTTP 잡 API** (신규 `src/http/`): `POST /jobs`(seed+provider) → job_id, `GET /jobs/:id`(상태), `GET /jobs/:id/report`(HTML/JSON). 기존 `runPipeline`을 감싸는 얇은 잡 큐.
- **시드 주입**: 확장이 넘긴 JS 본문을 `IngestedFile[]`로 바로 채택(재fetch 생략). URL만 온 경우 직접 fetch. 그 위에 `BrowserDiscoverer`로 빈틈 수집.
- **provider 추상화** (신규): 아래 §provider 참고.
- **단일 바이너리 패키징**: `bun build --compile` 또는 `pkg`로 OS별(mac-arm64/linux-x64/win-x64) 바이너리 산출 → JAR에 내장.

## provider 추상화 (D1·D4의 핵심)

결정론 파이프라인은 그대로. LLM 호출 단계만 전략으로 분리. 기존 `LlmClient.callJSON(opts)`를 인터페이스로 승격:

```
interface LlmProvider {
  callJSON<T>(opts): Promise<T | null>   // 구조화 JSON 반환 계약 유지
}
```

| provider | 구현 | 인증/설정 |
|---|---|---|
| **SDK** | 기존 `LlmClient` (Anthropic/OpenAI 호환 HTTP) | 확장 UI에서 **base URL + 토큰** 입력 → `ANTHROPIC_BASE_URL`/authToken |
| **Claude Code** | `claude -p "<prompt>"` shell out, stdout 파싱 | 사용자 로컬 `claude` 로그인 사용 |
| **Codex** | `codex exec "<prompt>"` shell out, stdout 파싱 | 사용자 로컬 `codex` 로그인 사용 |

⚠️ 설계 리스크: **CLI provider는 자유형 텍스트를 뱉음.** analyze/judge는 스키마 JSON을 요구하므로, CLI provider는 (a) 프롬프트에 "JSON만 출력" 강제 + (b) `extractJson` 재사용 + (c) 실패 시 재시도/degrade로 계약을 맞춰야 한다. 이게 CLI provider 구현의 가장 큰 일감.

## 데이터 흐름 (한 번의 분석)

1. 사용자가 Burp에서 대상 호스트 선택 + provider 설정.
2. 확장이 Burp history에서 그 호스트의 JS(URL+본문) 수집.
3. 확장이 코어에 `POST /jobs {seedFiles, provider}` 제출.
4. 코어: seed를 `IngestedFile[]`로 채택 → Playwright로 빈틈(동적 주입·미방문) 보강.
5. 코어: unbundle → 정적 pre-pass → analyze(provider) → judge(provider).
6. 확장이 폴링으로 완료 감지 → `GET /jobs/:id/report` → Burp 탭 렌더.

## 배포 / CI (D6)

- **CI**: `git tag vX.Y.Z` 푸시 → GitHub Actions:
  1. 코어 바이너리 3종 빌드(mac-arm64/linux-x64/win-x64).
  2. 바이너리를 `burp/` 리소스에 넣고 Gradle로 JAR 빌드.
  3. `js-analyzer-burp-X.Y.Z.jar`를 GitHub Releases에 첨부.
- 사용자는 Releases에서 버전 골라 JAR 다운로드 → Burp Extender에 로드.

## 빌드 순서 (마일스톤 분해)

붙을 대상이 있어야 하므로 **코어부터**:

1. **M1 — provider 추상화**: `LlmProvider` 인터페이스 + `SdkProvider`(기존) + `ClaudeCliProvider`(`claude -p`) + `CodexProvider`. 스키마 계약 유지 검증.
2. **M2 — 로컬 HTTP 잡 API** (`src/http/`): `runPipeline`을 잡 큐로 감싸 제출/폴링/리포트.
3. **M3 — seed 주입 경로**: 외부에서 받은 JS 본문을 파이프라인 입력으로 채택 + Playwright 빈틈 보강 병합.
4. **M4 — 단일 바이너리 패키징**: bun/pkg로 OS별 바이너리.
5. **M5 — Java Montoya 확장**: 컨텍스트 메뉴 + history 수집 + provider UI + 코어 spawn + 결과 탭.
6. **M6 — Release CI**: 태그 → 바이너리+JAR 빌드 → Releases.

## 리스크 / 열린 질문

- **R1 (품질)**: CLI provider(`claude -p`/codex)에서 스키마 JSON을 안정적으로 뽑을 수 있나? → M1에서 프롬프트+파싱+재시도로 계약 맞추고, 실패율 측정.
- **R2 (패키징)**: Playwright 브라우저를 번들 바이너리와 함께 어떻게 배포? → 최초 실행 시 `playwright install` 또는 시스템 크로미움 재사용. 사내망 오프라인이면 브라우저 사전 동봉 필요.
- **R3 (사내망)**: SDK base URL이 사내 게이트웨이일 때 커스텀 헤더 필요? → provider UI에 헤더 입력 추가 여부 결정.
- **R4 (JAR 용량)**: OS별 바이너리 3종 동봉 시 JAR 비대. → OS별 JAR 분리 배포 vs 단일 fat JAR 결정.
- **R5 (동시성/보안)**: 코어 HTTP는 localhost 바인딩 + 토큰 헤더로 로컬 격리. 포트 충돌 시 동적 포트 + 확장에 통지.

## The Assignment (다음 실제 행동)

코드 짜기 전에 **R1을 30분 안에 검증하라.** `claude -p`에 지금 `ANALYZE_SYSTEM` 프롬프트 + 취약 샘플 슬라이스(`samples/vulnerable.js`의 한 sink) 하나를 그대로 넣어 돌려보고, **스키마 JSON이 파싱 가능한 형태로 나오는지** 눈으로 확인. 나오면 B설계의 provider 계층이 성립하고, 안 나오면 CLI provider의 프롬프트/파싱 전략부터 다시 잡아야 한다. 이 한 번의 실험이 M1 전체의 성패를 좌우한다.
