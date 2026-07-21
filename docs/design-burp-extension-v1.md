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

Burp Suite에 **JAR 하나만 설치**하면, 분석 대상을 고르는 순간 Burp history의 그 대상 JS(사용자가 실제 브라우징한 트래픽)를 시드로 가져와 사용자가 고른 LLM provider(**SDK URL+토큰 / Claude Code / Codex**)로 진단하고, 코어가 띄운 **라이브 웹 페이지**에서 결과가 SSE로 실시간 흘러내린다.

## 확정된 결정 (office-hours)

| # | 결정 | 근거 |
|---|---|---|
| D1 | provider 선택 = **LLM 백엔드/인증만 교체**, 결정론 파이프라인은 유지 | (A) 채택. static pre-pass가 이 툴의 차별점 |
| D2 | 산출물 = **JAR 하나** (별도 Node 서버 설치 없음) | 분석가는 버프에 JAR 하나만 설치 |
| D3 | 엔진 위치 = **JAR이 Node 코어를 번들** (Approach B) | 방금 리팩터한 TS/Babel 코어 보존 + 단일 설치 |
| D4 | provider 3종: SDK(=HTTP, URL+토큰 입력) / Claude Code(`claude -p`) / Codex(`codex exec`) | 사내망 토큰 유연성. 비-SDK는 CLI shell out |
| ~~D5~~ | ~~시드 = Burp history URL+본문, Playwright는 빈틈만~~ → **D7로 개정** | |
| D6 | 배포 = 버전별 JAR을 **GitHub Releases**에 CI로 업로드 | 사용자가 버전 골라 설치 |
| **D7** | **Playwright 완전 제거.** 시드 = **Burp history/sitemap의 사용자 인터렉션 JS만**(+직접 `.js` fetch). 자동 크롤링·gap-fill 없음 | Burp 철학(테스터가 만진 것만) + **chromium 패키징 문제(R2) 소멸**, 바이너리 자기완결 |
| **D8** | **결과는 폴링이 아니라 SSE 스트리밍**(per-finding), 코어가 **라이브 웹 UI**를 서빙해 브라우저에서 렌더 | finding이 완료되는 대로 흘려보냄. Java Swing 렌더 부담 제거, 브라우저 EventSource가 소비 |

> **개정 2 (2026-07-21)**: D7(Playwright 제거) + D8(SSE + 라이브 웹 UI)로 D5와 폴링 방식을 대체함.

## 아키텍처

```
┌──────────────── Burp Suite ────────────────┐
│  [JAR] Java Montoya 확장 (더 얇아짐)          │
│   · 우클릭 "Analyze JS" / 대상(호스트) 선택     │
│   · history·sitemap에서 사용자 인터렉션 JS 수집 │
│   · provider 설정 UI (SDK URL+토큰 / CLI)      │
│   · 코어 spawn → POST /jobs → 라이브 URL 열기   │
│        │ localhost HTTP                       │
│        ▼                                      │
│  [번들 코어] Node 단일 바이너리 (자기완결)      │
│   · POST /jobs (seed JS + provider) → job_id  │
│   · 정적 pre-pass → analyze → judge           │
│   · onEvent Observer → finding·verdict emit   │
│   · GET /jobs/:id/events  (SSE 스트림)         │
│   · GET /jobs/:id/live    (라이브 웹 UI HTML)  │
└───────────────────────┬──────────────────────┘
                        │  Desktop.browse(라이브 URL)
                        ▼
        [브라우저] EventSource(/events) → finding 실시간 렌더
```

## 컴포넌트와 책임

### 1) Java Montoya 확장 (`burp/`) — 더 얇아짐
- **진입**: `BurpExtension` 구현, 우클릭 컨텍스트 메뉴 "Analyze JS" + 대상 선택.
- **시드 수집**: Montoya API `SiteMap`/proxy history에서 선택 대상 호스트의 응답 중 JS만 필터해 URL + 본문 확보 (D7 — 사용자 인터렉션 트래픽만).
- **provider 설정 UI**: 드롭다운(SDK / Claude Code / Codex). SDK 선택 시 **base URL + 토큰 입력 필드** 노출.
- **코어 생명주기**: 최초 실행 시 JAR 리소스에서 OS에 맞는 코어 바이너리 추출→spawn. 종료 시 정리.
- **잡 제출 → 브라우저 열기**: 코어에 `POST /jobs`로 seed+provider 제출 → 반환된 id로 `Desktop.getDesktop().browse("http://127.0.0.1:PORT/jobs/:id/live")`. **결과 렌더는 브라우저가 담당**(Swing 렌더 제거). Suite 탭엔 라이브 링크·상태만.

### 2) 번들 Node 코어 (기존 `src/` + `src/http/`, `src/agents/providers/`)
- **HTTP 잡 API** (`src/http/`): `POST /jobs`(seed+provider) → job_id, `GET /jobs/:id`(상태), `GET /jobs/:id/report`(최종 HTML). 기존 `runPipeline`을 감싸는 얇은 잡 큐.
- **SSE 스트림** (신규 `GET /jobs/:id/events`): `text/event-stream`. 파이프라인의 `onEvent` Observer가 흘리는 이벤트를 그대로 전달 — `stage`(진행), `finding`(analyze 결과 1건), `verdict`(judge 결과 1건), `done`(최종 meta). 연결은 `done`까지 유지.
- **라이브 웹 UI** (신규 `GET /jobs/:id/live`): 자기완결 HTML 1장. 브라우저 `EventSource('/jobs/:id/events')`로 이벤트를 받아 finding을 **실시간으로 행 추가**. 완료 시 `report.html`과 동일 요약. (다크 테마, 인라인 CSS/JS.)
- **시드 주입**: 확장이 넘긴 JS 본문을 `IngestedFile[]`로 바로 채택(재fetch 생략). URL만 온 경우 직접 `.js` fetch. **Playwright gap-fill 없음**(D7). 중복은 `dedupeFiles`로 접음.
- **provider 추상화**: 아래 §provider 참고.
- **단일 바이너리 패키징**: `bun build --compile` → OS별 바이너리. **Playwright 제거로 chromium 동봉 불필요, 바이너리 자기완결**(D7).

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

## SSE 스트리밍 + 라이브 웹 UI (D8)

폴링 대신 파이프라인 이벤트를 흘려보낸다. 결정론 파이프라인은 그대로, **Observer 콜백만 스레딩**한다.

- **onEvent Observer**: `runPipeline(opts, onEvent?)`. `RunContext`가 emitter를 들고, 스테이지가 호출한다.
  - `AnalyzeStage`: finding이 완료되는 대로 `{type:'finding', ...}` emit (sink 병렬이라 순차 아님).
  - `JudgeStage`: verdict마다 `{type:'verdict', finding_id, status}` emit.
  - 스테이지 진입 시 `{type:'stage', name}`, 종료 시 `{type:'done', meta}`.
- **JobStore**: 잡별 이벤트 버퍼 + 구독자 목록. 늦게 붙은 SSE 연결에도 버퍼를 리플레이(초기 상태 보존).
- **`GET /jobs/:id/events`** (`text/event-stream`): 구독자로 등록, 각 이벤트를 `data: <json>\n\n`으로 전송. `done`에서 종료.
- **`GET /jobs/:id/live`**: 자기완결 HTML(다크, 인라인). `EventSource`로 finding을 실시간 행 추가, `verdict` 도착 시 해당 행 상태 갱신, `done`에서 요약 카드 표시. `report.html`의 라이브 버전.

## 데이터 흐름 (한 번의 분석)

1. 사용자가 Burp에서 대상 호스트 선택 + provider 설정.
2. 확장이 Burp history/sitemap에서 그 호스트의 JS(URL+본문) 수집 — **사용자 인터렉션 트래픽만**(D7).
3. 확장이 코어에 `POST /jobs {seedFiles, provider}` 제출 → job_id.
4. 확장이 `Desktop.browse("…/jobs/:id/live")`로 브라우저에 라이브 페이지를 연다.
5. 코어: seed 채택(dedupe) → unbundle → 정적 pre-pass → analyze → judge. **Playwright 없음**(D7).
6. 각 finding·verdict가 완료되는 대로 SSE로 흘러 브라우저 라이브 페이지에 **실시간 렌더**(D8).

## 배포 / CI (D6)

- **CI**: `git tag vX.Y.Z` 푸시 → GitHub Actions:
  1. 코어 바이너리 3종 빌드(mac-arm64/linux-x64/win-x64).
  2. 바이너리를 `burp/` 리소스에 넣고 Gradle로 JAR 빌드.
  3. `js-analyzer-burp-X.Y.Z.jar`를 GitHub Releases에 첨부.
- 사용자는 Releases에서 버전 골라 JAR 다운로드 → Burp Extender에 로드.

## 빌드 순서 (마일스톤 분해)

**M1~M6은 구현·실측 완료.** 개정 2로 추가/변경되는 작업:

| # | 상태 | 내용 |
|---|---|---|
| M1 provider 추상화 | ✅ | sdk / claude-cli / codex + factory |
| M2 HTTP 잡 API | ✅ | POST/poll/report + `serve` |
| M3 seed + dedupe | ✅ | Burp history 시드, content-hash 중복제거 |
| M4 단일 바이너리 | ✅ | bun `--compile` |
| M5 Java 확장 | 🟡 | CI 빌드 대기 |
| M6 Release CI | ✅ | 태그 → OS별 JAR |
| **M7 Playwright 제거 (D7)** | ⬜ | `BrowserDiscoverer`·acquire의 browser 경로·playwright 의존 삭제, `package-core.sh`의 `--external chromium-bidi` 제거, CLI URL 페이지 모드 제거(직접 `.js` fetch만 유지) |
| **M8 SSE + 라이브 UI (D8)** | ⬜ | `runPipeline`에 `onEvent`, 스테이지 emit, JobStore 이벤트 버퍼/구독, `GET /jobs/:id/events`(SSE) + `GET /jobs/:id/live`(HTML) |
| **M9 Java 슬림화** | ⬜ | 확장이 폴링·Swing 렌더 대신 `Desktop.browse(live URL)`. `CoreClient` 폴링 제거 |

## 리스크 / 열린 질문

- ~~**R1**~~ ✅ 해소: `claude -p`가 스키마 JSON 3/3 통과(실측).
- ~~**R2 (Playwright 패키징)**~~ ✅ **소멸**: D7로 Playwright 제거 → chromium 동봉 불필요, 바이너리 자기완결.
- **R3 (사내망)**: SDK base URL이 사내 게이트웨이일 때 커스텀 헤더 필요? → provider UI에 헤더 입력 추가 여부.
- **R4 (JAR 용량)**: OS별 바이너리 3종 동봉 시 JAR 비대. → OS별 JAR 분리 배포(현 CI 방식).
- **R5 (보안)**: 코어 HTTP는 localhost 바인딩 + 토큰. **라이브 UI/SSE도 같은 토큰 게이트** 필요(브라우저가 토큰을 보내야 하므로 `live` URL에 일회용 토큰 쿼리 포함 검토).
- **R6 (신규, D7)**: 사용자 인터렉션 트래픽만 쓰면 **커버리지 하락** — 사용자가 방문 안 한 페이지의 JS는 안 잡힘. 이게 의도(테스터 스코프 존중)지만, "이 호스트 전체 sitemap 큐잉" 토글을 옵션으로 둘지 검토.

## The Assignment (다음 실제 행동)

**M8의 SSE 이벤트 스키마부터 30분 안에 종이에 못 박아라.** `finding`·`verdict`·`stage`·`done` 각 이벤트의 필드를 확정하면, 코어 emit·SSE 직렬화·라이브 HTML 렌더·(나중에) 다른 클라이언트가 전부 그 계약에 붙는다. 특히 **finding과 verdict의 상관키(finding_id)**와, 늦게 붙은 SSE 연결에 **버퍼 리플레이**를 어떻게 할지(이미 끝난 finding도 보여야 함)를 정하는 게 핵심. 이 스키마가 M8~M9 전체를 정한다.
