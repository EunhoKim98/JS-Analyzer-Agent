# 설계 문서: JS Analyzer Agent (js_anal_agent)

생성: /office-hours · 2026-07-16 · 개정(brainstorming): 2026-07-16 (v2)
모드: Builder (보안 연구/도구)
상태: DRAFT
확정 사항:
- 배포 아키텍처: 독립 코어 + 래퍼
- v1 범위: 전체 6-에이전트 파이프라인, 단계적 구현
- 테인트 추적: **휴리스틱/로컬**(intra-procedural + 근접 source/sanitizer 매칭)
기본값(변경 가능):
- 코어 언어: TypeScript/Node
- Burp 트리거: 수동(우클릭) + 비동기 잡 큐
- 취약점 커버리지: 확장형 룰 레지스트리로 **JS 전 영역** 지향(§15). v1은 시드 우선순위대로 단계 배치
- Burp 자동 큐잉: 기본=수동, 자동은 v1.0 옵션 토글
- 활성 검증(라이브 PoC): **기본 OFF**. 켤 때만 실제 요청 발생 — 전송 전 확인·프록시 경유·헤더 주입(§7.1, §14.1)

---

## 1. 문제 정의

웹 프론트엔드 JavaScript(특히 minified/번들된 프로덕션 코드)에서 자산 수집 → 취약점 분석 →
정오탐 판별 → HTML 리포트 + JSON 자산 산출을 수행하는 멀티에이전트 하네스.
Burp Suite 확장과 Claude Code 에이전트 양쪽에서 사용 가능해야 함.

## 2. 무엇이 이 도구를 다르게 만드는가

기존 오픈소스 4종(JSAnalyzer, JS-Analyser, ai-js-analyzer, js_analyser)은 대부분
regex 기반 엔드포인트/시크릿 추출기(LinkFinder 계열). 차별점 세 가지:
1. **결정론적 정적분석 선행** → LLM은 검증 가능한 슬라이스만 본다.
2. **정오탐 판별을 1급 기능으로** → 보안 도구 신뢰의 핵심은 false positive rate.
3. **멀티턴 체이닝 추론** → source→sink 경로와 취약점 연결 추론.

regex 추출 패턴은 재발명하지 않고 JSAnalyzer/LinkFinder에서 차용.

## 3. 설계 원칙 (Karpathy 하네스 방법론 적용)

| # | 원칙 | 적용 |
|---|------|------|
| 1 | 오케스트레이터 = OS | 오케스트레이터는 **순수 코드**. 메모리 관리 + 짧은 수명 에이전트 스케줄링. |
| 2 | 한 에이전트 = 하나의 좁고 검증 가능한 일 | 6 역할 분리, 각 단계 구조화 아티팩트. |
| 3 | 자율성 슬라이더 | 자산 추출·sink 매칭=고자율. 악용성·심각도=저자율+휴먼 게이트. |
| 4 | 생성-검증 루프 (검증을 싸게) | 모든 finding은 재실행 가능한 증거 패킷 포함. |
| 5 | 짧은 리시 | 메가 에이전트 금지, 단계별 감사. |
| 6 | LLM은 검증 가능한 것을 자동화 | 정적 검사 가능한 것은 결정론, 주관적 판단만 LLM. |
| 7 | jagged intelligence | 모든 LLM 판정에 결정론 재검사 + 별도 judge 교차검증. |
| 8 | 메모리 외부화, 실행은 짧게 | 상태는 스키마 스토어, 에이전트는 stateless. |
| 9 | 목표+스키마, "uncertain"을 1급 출력 | 애매하면 버리거나 단정 말고 `uncertain` 플래그. |
| 10 | 코퍼스(works.all)로 평가 | 라벨 벤치마크로 precision/recall 추적. |

## 4. 아키텍처

### 4.1 독립 코어 + 래퍼

```
                    ┌─────────────────────────────────────────┐
                    │  독립 코어 (TypeScript/Node)              │
                    │  - 언번들 + 결정론 정적분석(AST/휴리스틱)  │
                    │  - 오케스트레이터(코드) + 상태 스토어      │
                    │  - Anthropic API 호출(에이전트, temp=0)   │
                    │  - 리포트 생성 · Local HTTP API · CLI      │
                    └───────────────┬─────────────────────────┘
        ┌───────────────────────────┼───────────────────────────┐
┌───────▼────────┐        ┌─────────▼─────────┐       ┌─────────▼─────────┐
│ Burp 확장       │        │ CLI               │       │ Claude Code 래퍼   │
│ (Java/Montoya)  │        │ (직접 실행)         │       │ (skill/agent)      │
│ 우클릭→잡 제출   │        │ 파일/URL/디렉토리   │       │ CLI shell out      │
│ 폴링→결과 패널   │        │                    │       │                    │
└─────────────────┘        └───────────────────┘       └────────────────────┘
```

**코어 = TypeScript/Node**(기본값): JS AST(`@babel/parser`/`acorn`/`tree-sitter`),
언번들(`webcrack`), 소스맵(`source-map`/`unwebpack-sourcemap`), beautify(`js-beautify`),
Anthropic SDK(`@anthropic-ai/sdk`) 생태계가 Node 네이티브. Burp(Java)는 코어를
로컬 HTTP로 호출 → 코어 로직 중복 없음.

### 4.2 파이프라인 (9단계 [0]~[8] — 언번들 + 결정론 pre-pass 포함, LLM 에이전트 6개)

```
[0] 수집(Ingest)          JS 파일/URL/번들 입력. content-hash 계산(캐시 키). 결정론.
[1] 언번들(Unbundle)      소스맵 있으면 원본 복원 → reconstructed/.
                          없으면 webcrack로 모듈 분할 + js-beautify 정규화. 결정론.
[2] 정적 pre-pass         AST → sink·source·sanitizer·자산·시크릿 국소 추출 + 휴리스틱
                          source→sink 근접 매칭. ⚠ LLM 없음. sinks.json/asset_manifest.json.
[3] 탐색(Explore)         [Sonnet] 모듈/진입점 우선순위화, 결정론 결과 보강. explore_notes.json.
[4] 자산 수집(Assets)      [Sonnet] regex 후보를 문맥으로 검증·분류. assets.json.
[5] 취약점 분석(Analyze)   [Sonnet, 후보별 OODA, 병렬 팬아웃] 슬라이스 분석. findings.jsonl.
[6] 체이닝(Chain)         [Opus] findings+자산 종합, 취약점 연결·시나리오. chains.json.
[7] 정오탐 판별(Judge)     [Opus] 교차검증 judge + 결정론 재검사. verdicts.json.
[8] 리포트(Report)        [Sonnet] HTML + JSON + (옵션)SARIF. 휴먼 게이트.
```

오케스트레이터(코드)가 스케줄링하고 각 에이전트에 **최소 충분 컨텍스트만** 페이징.

### 4.3 에이전트 / 모델 배정

| 단계 | 역할 | 주체 | 모델 | 자율성 | 병렬 |
|------|------|------|------|--------|------|
| 0-2 | 수집·언번들·정적 pre-pass | 코드 | — | 결정론 | 모듈 병렬 |
| 3 | 탐색 | 에이전트 | `claude-sonnet-5` | 고 | — |
| 4 | 자산 수집 | 에이전트 | `claude-sonnet-5` | 고 | — |
| 5 | 취약점 분석(OODA) | 에이전트 | `claude-sonnet-5` | 중 | **sink별 병렬(상한 N)** |
| 6 | 체이닝 | 에이전트 | `claude-opus-4-8` | 저 | — |
| 7 | 정오탐 판별 | 에이전트 | `claude-opus-4-8` | 저 + 휴먼 게이트 | finding별 병렬 |
| 8 | 보고서 | 에이전트 | `claude-sonnet-5` | 중 | — |
| 전체 | 스케줄링 | 코드 | — | — | — |

- 모델 배정은 하드코딩하지 말고 config로 노출.
- 모든 LLM 호출 **temperature=0** + 프롬프트 캐싱(재현성·비용). sink는 독립이라 [5]는 병렬.
- 스펙의 "오케스트레이터(Opus)"는 루프 제어가 아니라 **체이닝 추론**으로 재배치(루프는 코드).

### 4.4 상태 저장소 (스키마 기반) + 캐싱

```
runs/<run_id>/
  meta.json            # 대상, content-hash, config, 파이프라인 상태, 토큰 사용량
  raw/                 # 원본 JS
  reconstructed/       # 소스맵 복원 or 언번들 결과
  asset_manifest.json  # [2] 결정론 추출 원자료
  sinks.json           # [2] sink + 근접 source/sanitizer + 휴리스틱 경로
  explore_notes.json   # [3]
  assets.json          # [4] 최종 자산(경로/API/param/secret)
  findings.jsonl       # [5] finding별 증거 패킷 (append-only)
  chains.json          # [6]
  verdicts.json        # [7]
  dedup.idx            # 런 내 중복 분석 방지 키
  report.html / assets_export.json / findings.sarif   # [8]

cache/<content-hash>/  # 크로스런 캐시: 같은 번들 재분석 시 [1][2] 및 확정 verdict 재사용
```

`cache/`는 content-hash 기반 — Burp가 같은 번들을 반복해서 봐도 언번들·정적분석·확정
판정을 재사용해 재과금 방지. 다음 라운드 에이전트는 스토어를 읽어 멀티턴 체이닝.

### 4.5 OODA — 구체 정의 (단계 [5])

각 후보 sink마다 1회전:
- **Observe**: 정적 pre-pass가 준 슬라이스(함수 조각 + sink + 근접 source + 문맥) 읽기.
- **Orient**: 취약점 클래스 분류 + 해당 클래스 **룰카드**(§15 분류표) 로드.
- **Decide**: 신뢰불가 입력이 sanitizer 없이 sink에 도달·악용 가능? → {vulnerable|not_vulnerable|uncertain}.
- **Act**: vulnerable/uncertain → **증거 패킷**(§8 스키마) 산출·append. 컨텍스트 부족 →
  오케스트레이터에 특정 심볼 슬라이스 추가 요청(라운드 상한 존재).

### 4.6 컨텍스트 엔지니어링

**절대 원본 번들 전체를 어떤 윈도우에도 넣지 않는다.** 탐색=모듈 목록+요약, 자산=후보+주변 N줄,
분석=함수 슬라이스+sink+source+룰카드(한 후보씩), 체이닝=findings+assets 요약(코드 아님),
판별=단일 증거 패킷+관련 슬라이스.
컨텍스트가 최대 60%가 할당된 경우 중요도에 따라 압축

### 4.7 테인트 추적 (휴리스틱/로컬 — 확정)

v1은 완전한 inter-procedural 데이터플로우를 시도하지 않는다(minified/번들에서 비현실적).
대신:
- **국소(intra-procedural) 매칭**: 각 sink 노드에서 AST를 거슬러 올라가며 같은 스코프·근접
  범위의 source/sanitizer 패턴을 탐지. tree-sitter/AST 쿼리로 구현.
- **얕은 별칭 추적**: 직접 대입(`var x = location.hash; el.innerHTML = x`) 정도의 1~2홉 별칭만.
- **결과 등급**: `direct`(source가 sink에 직접) / `aliased`(얕은 별칭) / `sink_only`(source 미발견).
- 완전 데이터플로우가 아니므로 **일부 FN 감수**. 놓친 경로는 [5] LLM 슬라이스 분석이 문맥으로 보강,
  `sink_only`도 LLM에 넘겨 source 추정. 정확도는 §13 코퍼스로 측정.
- (v2 후보) 선택적 CodeQL 백엔드 플러그인 — 원본 소스가 있는 화이트박스 상황에서만.

### 4.8 토큰 예산 & sink 우선순위

- 정적 pre-pass가 sink를 M개로 산출 → **source 존재 → 경로등급 → severity 순 랭킹**
  (minified에선 대부분 sink_only로 degrade하므로 source 존재가 severity보다 강한 신호 — 실측 확인).
- **기본은 전체 분석(무제한)**. `--max-sinks K`(또는 config)로 상한을 두면 상위 K개만 [5] LLM 분석하고
  나머지는 리포트에 `unanalyzed(정적만)`로 기록(무성 절단 금지, Karpathy 원칙 10).
- 슬라이스는 배치로 묶어 호출, sink별 병렬(동시성 상한 N).
- run별 토큰 상한을 `meta.json`에 기록, 초과 시 랭킹 하위부터 중단 + 리포트에 명시.

### 4.9 에러 처리 & 재현성

- 에이전트 응답은 **엄격 스키마 검증**(§8). malformed → 최대 R회 재시도 → 실패 시 해당 항목
  `error` 마킹하고 파이프라인 계속(부분 실패가 전체를 죽이지 않음).
- 타임아웃·레이트리밋 → 지수 백오프.
- temperature=0 + 고정 프롬프트 + content-hash 캐시로 **재실행 재현성** 확보.

### 4.10 관측성

- run별 각 에이전트의 prompt/response/토큰을 `runs/<id>/trace/` JSONL로 기록(멀티에이전트 디버깅 필수).
- 파이프라인 단계 상태·소요·에러를 `meta.json`에 집계.

### 4.11 JS 획득 (Acquisition) — 서피스별 앞단

분석 대상 JS를 **어디서 얻느냐**는 배포 서피스마다 다르다. 파이프라인 [1]~[8]은 동일하고
**획득 앞단만 교체**한다:

- **Burp 확장**: 프록시가 이미 트래픽을 본다. **스코프 내 호스트의 JS 응답만** 필터(MIME
  `application/javascript`/`.js` + Burp 스코프 일치)해서 코어에 시드로 제출. 크롤링 불필요.
- **Claude Code / CLI**: **파일·디렉토리 또는 직접 `.js` URL**을 입력받아 원문을 그대로 수집한다.
  헤드리스 브라우저 로드·자동 크롤링·동적 스크립트 gap-fill은 하지 않는다(**D7로 Playwright 완전
  제거** — chromium 동봉 불필요, 바이너리 자기완결). 페이지 전체의 JS가 필요하면 Burp 확장 시드를
  쓴다(테스터가 실제 만진 트래픽만 분석).

수집된 각 JS는 content-hash로 dedup(`dedupeFiles`) 후 [1] 언번들로 진입.

> **개정(D7, 2026-07-21)**: 본래 v0.3 계획은 CLI가 Playwright로 페이지를 로드해 스크립트를
> 수집하는 것이었으나, Burp 철학(사용자 인터렉션 트래픽만)과 chromium 패키징 문제(R2)로 인해
> **Playwright 경로를 폐기**하고 획득을 "파일/`.js` URL/Burp 시드"로 한정했다.

## 5. 자산 파악

1. **경로/API/param 노출**: regex(LinkFinder/JSAnalyzer 패턴 차용) + AST 문맥 검증.
   fetch/XHR/axios, 상대·절대 경로, 쿼리 파라미터, GraphQL 엔드포인트.
2. **시크릿 탐지**: API 키/토큰/JWT/클라우드 크레덴셜(trufflehog/gitleaks 룰 차용).
   **FP 처리 필수** — 클라이언트용 공개키(Firebase config, Stripe publishable `pk_`)는 취약점 아님.
   엔트로피 + 키 프리픽스/문맥으로 `sensitive` vs `public` 분류, 라이브 검증은 하지 않음.
3. **언번들/소스맵**: `.map`(외부/inline) 있으면 원본 복원, 없으면 webcrack 모듈 분할 + beautify.
   복원 원본을 대상으로 [2]~[7] 재실행(원본이 minified보다 품질 훨씬 높음).
4. **라이브러리 버전 지문 → CVE, 그리고 분석 라우팅**: retire.js 시그니처로 번들 내 알려진
   라이브러리@버전을 결정론적으로 탐지하고 CVE 매칭(LLM 불필요). 이걸 **라우팅 게이트**로 사용 —
   벤더/라이브러리 파일(파일명 휴리스틱 또는 지문 매칭)의 sink는 per-sink LLM 분석 **대상에서 제외**하고
   CVE 경로로 보낸다(jQuery 내부를 하나하나 분석하지 않음). **단 예외**: 벤더 sink라도 source가
   실제로 잡힌 것(예: 오리진 체크 없는 postMessage 핸들러)은 진짜 리드이므로 분석 유지.
   `analyzeVendorSinks: true`로 전체 분석 강제 가능.
   - **한계(실측)**: 콘텐츠 시그니처는 CDN/명명 파일(`jquery-3.4.1.min.js`, 라이선스 주석 잔존 번들)에선
     잘 잡지만, rolldown/vite로 tree-shake+주석 제거된 번들에선 버전 마커가 사라져 지문이 0이 될 수 있다.
     이 경우에도 라우팅(벤더 sink 스킵)은 유효해 비용을 크게 줄인다.
   - AST 파싱 실패(exotic minified 문법) 시 regex 폴백으로 sink 회수(파일 통째 유실 방지).

## 6. 취약점 분석 & 체이닝 (멀티턴)

- [5]는 sink별 독립 OODA(짧은 수명, 외부 메모리, 병렬).
- [6] 체이닝은 [Opus]가 `findings.jsonl`+`assets.json` 종합: 예) 노출된 관리 API 경로 +
  그 경로 관련 DOM-XSS sink → 연계 시나리오. 라운드마다 append, 다음 라운드가 읽어 이어감.

## 7. 정오탐 판별 (단계 [7])

정직한 서술 — **결정론 재검사는 "패턴 실존"만 확인하지 악용성을 증명하지 않는다.**
`confirmed` 조건:
1. **결정론 재검사**: finding의 AST/regex assert 재실행 → 패턴이 코드에 실존 확인
   (→ "패턴이 없는데 만들어낸" FP 제거).
2. **교차검증 judge**: 분석 에이전트와 **다르게 프롬프트된** Opus judge가 악용 가능성 독립 판정
   (→ "패턴은 있으나 악용 불가"한 FP 제거).
3. 1과 2가 **합의**할 때만 `confirmed`. 불일치 → `needs_review`(휴먼 게이트).

단일 에이전트 판정을 신뢰하지 않는다(Karpathy 원칙 7).

### 7.1 활성 검증 (라이브 PoC — 선택적, 기본 OFF)

정적·LLM 판정만으로 악용성을 확정 못 하는 경우(특히 DOM-XSS·open-redirect·postMessage)가 있다.
이때 **실제로 요청을 보내거나 페이로드를 렌더해서** 취약점 발동을 확인하는 3번째 판별 티어.

- **기본 OFF.** `--active`(CLI) / config로 명시적으로 켤 때만 동작. 켜도 **전송 전 확인**(§14.1).
- **PoC 러너 3종**:
  - `browser`: 헤드리스 브라우저(Playwright)로 대상 페이지 로드 + URL/hash에 **양성 카나리
    페이로드**(실제 피해 없이 전역 콜백/변수만 트리거) 주입 → sink 발동(콜백 호출·DOM 변이) 관측.
  - `http`: 엔드포인트/파라미터 finding을 **읽기 전용(GET)** 요청으로 재현 확인.
  - `url`: 리다이렉트류를 요청 후 `Location` 관측.
- **비파괴 원칙**: 상태 변경(POST/PUT/DELETE·결제·삭제) 요청은 자동 실행 금지 — PoC 문자열만 생성,
  실행은 사람이. 카나리 페이로드는 실제 피해 없는 마커만.
- 결과: `verdicts.json`에 `active_verified` + 증거(콘솔 로그·응답 스냅샷). 성공 시
  `confirmed-active`(가장 높은 신뢰), 실패해도 정적 finding은 남되 신뢰 등급 하향.

## 8. 에이전트 간 인터페이스 스키마 (핸드오프 계약)

멀티에이전트 설계의 핵심 = 계약. 최소 3개 스키마 고정(JSON):

```jsonc
// sinks.json 항목 (정적 pre-pass 산출)
{
  "id": "sink_0007",
  "class": "dom-xss",                 // §15 분류표
  "sink": { "api": "Element.innerHTML", "file": "app.js", "line": 1423, "span": [1423,1425] },
  "source": { "found": true, "kind": "location.hash", "hops": 1 },
  "sanitizer": { "found": false },
  "path_grade": "aliased",            // direct | aliased | sink_only
  "severity_hint": "high"
}

// findings.jsonl 항목 (분석 에이전트 [5] 산출 — 증거 패킷)
{
  "id": "find_0007",
  "sink_id": "sink_0007",
  "class": "dom-xss",
  "verdict": "vulnerable",            // vulnerable | not_vulnerable | uncertain
  "confidence": 0.8,
  "evidence": {
    "taint_path": ["location.hash", "var q", "el.innerHTML"],
    "assumed_input": "#<img src=x onerror=alert(1)>",
    "recheck_assert": "ast: MemberExpression[property=innerHTML] assigned from tainted var",
    "poc": {                              // 구조화 PoC (가능할 때만)
      "type": "browser",                  // browser | http | url
      "payload": "#<img src=x onerror=__canary()>",
      "target": "https://target/page",
      "expected": "canary callback fired",
      "destructive": false                // true면 자동 실행 금지, 문자열만
    },
    "file": "app.js", "span": [1423,1425]
  }
}

// verdicts.json 항목 (판별 에이전트 [7] 산출)
{
  "finding_id": "find_0007",
  "status": "confirmed-active",      // confirmed-active | confirmed | needs_review | rejected
  "deterministic_recheck": true,
  "judge_verdict": "exploitable",
  "active_verified": true,           // 활성 검증(§7.1) 실행 시에만
  "active_evidence": "console: __canary called at app.js:1424",
  "reason": "unsanitized location.hash reaches innerHTML"
}
```

`assets_export.json`(외부 소비용)도 경로/API/param/secret 각각 스키마 고정.

## 9. 보고서

- **HTML**: 취약점(심각도·클래스·파일:라인·taint 경로·PoC·증거), 자산 요약,
  confirmed vs needs_review vs unanalyzed 구분. 자기완결형(인라인 CSS).
- **JSON 자산**(`assets_export.json`): 외부 도구 소비용.
- **(옵션) SARIF**: CI/보안 도구 상호운용.

## 10. 배포

- **CLI**: `js-analyzer analyze <file|url|dir> [--sourcemap] [--max-sinks K] [--config ...]`.
- **Local HTTP API**: `POST /jobs`(분석 제출)→ job_id, `GET /jobs/:id`(폴링), `GET /jobs/:id/report`.
- **Burp 확장(Java/Montoya)**: 기본값 = **우클릭 → "Analyze JS"**(수동 트리거, 노이즈·비용 회피).
  코어에 잡 제출 → 백그라운드 폴링 → Burp 탭에 결과 렌더. (옵션: 스코프 내 JS 자동 큐잉 토글.)
  확장 자체는 얇게(코어 로직 없음).
- **Claude Code 래퍼**: skill/agent가 CLI를 shell out.

## 11. 테스트 전략

- **결정론 컴포넌트 단위 테스트**: 언번들·AST 추출·휴리스틱 매칭·소스맵 복원 → 고정 픽스처 입출력.
- **에이전트 계약 테스트**: 스키마 검증 + 프롬프트 스냅샷.
- **코퍼스 회귀(§13)**: 라벨 번들에 대해 precision/recall 추적, PR마다 실행.
- **골든 리포트**: 대표 입력에 대한 리포트 스냅샷 비교(비결정 필드 제외).

## 12. 마일스톤 (A→B 확장)

- **v0.1**: [0][1][2] 결정론(언번들+정적) + [5] Sonnet 분석 1개(OODA) + [7] Opus FP + [8] HTML/JSON. CLI만.
- **v0.2**: [4] 자산 수집 + 시크릿 탐지(FP 분류) + assets_export.json.
- **v0.3**: [3] 탐색 + 소스맵 복원 경로.
- **v0.4**: [6] 체이닝(Opus) + 교차검증 judge + 토큰 예산/우선순위.
- **v0.5**: 평가 코퍼스 + precision/recall + 캐싱.
- **v0.6**: 활성 검증(§7.1) — Playwright PoC 러너(browser/http/url) + 아웃바운드 가드레일(§14.1). 기본 OFF.
- **v1.0**: Burp Montoya 확장 + Local HTTP API + Claude Code 래퍼 + 관측성. Burp 경유 활성 검증.

## 13. 평가 코퍼스

라벨 벤치마크: 알려진 취약 번들 + 알려진 안전 패턴(공개키 등 FP 유발 포함) + minified/obfuscated.
변경마다 클래스별 precision/recall 추적, **false positive rate를 1급 지표로**. 개선은 측정으로.

## 14. 안전 / 권한 가드레일

- **기본은 정적 분석.** 활성 검증(§7.1)은 opt-in이며 읽기 전용·비파괴·전송 전 확인.
  상태변경 익스플로잇·자동 외부 보고는 금지.
- confirmed도 외부 자동 전송/파일링 금지 — 휴먼 게이트 필수.
- 인가된 테스트(펜테스트/버그바운티 스코프 내)에서만 사용. 스코프 확인 책임은 사용자.

### 14.1 아웃바운드 트래픽 가드레일 (활성 검증 시)

활성 검증(§7.1)을 켜면 실제 트래픽이 나간다. 다음을 강제:
- **명시적 opt-in + 전송 전 확인**: 나갈 요청 목록(메서드·URL·헤더 요약)을 보여주고 승인받은 뒤 전송.
- **스코프 강제**: in-scope 호스트 화이트리스트에만 전송.
- **헤더/세션 주입**(인증 표면 테스트용) 계층:
  - 코어: `js-analyzer.config.json`(canonical) — headers/cookies/proxy/scope.
  - Claude Code 래퍼: **CLAUDE.md 지시 + PreToolUse Hook**으로 아웃바운드 요청 직전 헤더 주입/
    프록시 강제/차단(사용자 제안 반영).
  - Burp 확장: **Burp 자체를 경유**(Montoya `Http.sendRequest`) → 요청이 Burp 히스토리에 남고
    Burp 세션·업스트림·스코프 설정을 그대로 상속.
- **프록시 경유 옵션**: 활성 검증 켤 때 "프록시(예: Burp 127.0.0.1:8080) 경유할까요?" 질문 →
  `--proxy` / config. 펜테스터가 모든 요청을 보고 제어.
- **레이트리밋 + 비파괴**: 아웃바운드 스로틀, 상태변경 요청 자동 실행 금지(§7.1).

## 15. 취약점 커버리지: 확장형 룰 레지스트리 (JS 전 영역 지향)

목표는 "JS에서 발생 가능한 모든 취약점 영역" 커버. 핵심은 **파이프라인이 클래스에 무관**하다는 점 —
[2] 정적 pre-pass와 [5] 분석은 룰카드를 **데이터로 읽어** 동작하므로, **커버리지 확대 = 코드가 아니라
룰카드(데이터) 추가**다. 따라서 "모든 영역"은 v1 산출물이 아니라 구조적 확장 속성으로 달성한다.

세 겹으로 커버:
1. **룰 레지스트리(데이터)** — 클래스마다 룰카드 1개(`rules/*.yaml`): source/sink/sanitizer/severity.
2. **LLM 일반화** — [5] 분석 에이전트가 시드 룰을 넘어 문맥으로 변형·조합을 포착.
3. **오픈 디스커버리(폴백)** — 레지스트리에 없는 의심 패턴도 LLM이 `uncertain`으로 flag → [7] 판별로.
   확인되면 새 룰카드로 승격(미등록 신종 미탐 방지).

### 15.1 취약점 영역 분류 (레지스트리 백본)

PortSwigger DOM-based vulnerabilities 택소노미를 백본으로, 클라이언트 JS 전 영역을 패밀리로 조직:

| 패밀리 | 클래스 | 시드 배치 |
|--------|--------|:---:|
| DOM 인젝션 | DOM-XSS, mutation XSS, DOM open-redirect, DOM cookie/link/JSON/web-message/Ajax-header/file-path/WebSocket-URL 조작, DOM clobbering, WebSQL, HTML5-storage 조작, client-side DoS | v0.1~v0.4 |
| 프로토타입 오염 | client-side prototype pollution + gadget chain | v0.1 |
| 리다이렉트/요청 | open redirect, client-side CSRF, SSRF 힌트 | v0.2 |
| 메시징/교차출처 | postMessage origin 미검증, CORS 오설정, WebSocket origin, document.domain 완화 | v0.2 |
| 시크릿/정보노출 | 하드코딩 키·토큰·JWT·클라우드 크레덴셜, 내부 경로·디버그 플래그, 소스맵 노출 | v0.2 |
| 인젝션/eval | eval/Function/setTimeout(string) 주입, CSTI(AngularJS 샌드박스 탈출), JSONP 주입 | v0.3 |
| 크립토/인증 | 안전하지 않은 난수(Math.random), 클라 롤드 크립토, OAuth implicit 토큰 URL 노출 | v0.3 |
| 스토리지 | localStorage/sessionStorage/쿠키 민감정보(플래그 없음), IndexedDB | v0.3 |
| 공급망/무결성 | 알려진 취약 라이브러리 버전(retire.js식), SRI 누락, http/신뢰불가 CDN 로드 | v0.2 |
| 가용성 | 클라이언트 ReDoS | v0.4 |
| UI redress | tabnabbing(`target=_blank` no `rel=noopener`) | v0.4 |

각 클래스는 `rules/<class>.yaml` 룰카드 1개로 등록. 새 영역 = 카드 추가(코드 변경 없음).

### 15.2 룰카드 시드 예시 (source / sink / sanitizer)

가장 값나가는 5개 클래스의 시드(정확도의 상당수가 여기). 나머지는 위 배치대로 카드 추가.

| 클래스 | source (신뢰불가 입력) | sink | sanitizer |
|--------|------------------------|------|-----------|
| dom-xss | `location.*`, `document.URL/referrer`, `window.name`, `postMessage.data`, `document.cookie` | `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`, `eval`, `Function`, `setAttribute(on*)`, jQuery `.html()` | `DOMPurify`, `textContent`, `encodeURIComponent`, 프레임워크 이스케이프 |
| proto-pollution | 사용자 제어 키의 재귀 merge/`Object.assign`, `JSON.parse`+deep-merge | `obj[k1][k2]=v`, `Object.setPrototypeOf`, `__proto__`/`constructor`/`prototype` 접근 | 키 검증(`__proto__` 차단), `Object.create(null)`, `Map` |
| open-redirect | `location.*`, 쿼리 파라미터 | `location.href/assign/replace`, `window.open`, `<a>.href` 대입 | allowlist, 상대경로 강제 |
| postMessage | `event.data`, `event.origin` 미검증 | 위 dom-xss sink로 전달, `eval` | `event.origin` 검증, 구조화 파싱 |
| secret | (해당없음 — 정적 패턴) | 하드코딩 키/토큰/JWT/클라우드 크레덴셜 | `public` 프리픽스(`pk_`, Firebase) 제외 분류 |

## 16. 결정된 사항 / 잔여

- **(결정) 취약점 커버리지** = 확장형 룰 레지스트리로 JS 전 영역 지향(§15). 파이프라인 불변,
  룰카드 데이터 추가로 확장. v1은 §15.1 시드 배치대로 단계 진행 + 오픈 디스커버리 폴백.
- **(결정) Burp 트리거** = 기본 수동(우클릭), 자동 큐잉은 v1.0 옵션 토글.
- **(결정) 토큰 상한(K, N)** = 지금 못 박지 않음 → 코퍼스로 실측 튜닝(§13). v0.1은 보수적 기본값으로 시작.
- (잔여) 룰카드 스키마(YAML) 필드 최종 확정은 v0.1 착수 시 §8 스키마와 함께.

## 17. The Assignment (다음 실제 행동)

**대표 minified 번들 3~5개를 골라 `corpus/`에 넣고, 각각 "이런 취약점 있다/없다"를 사람이 라벨링하라.**
공개키 같은 FP 유발 케이스를 반드시 하나 이상 포함. 코드 한 줄 짜기 전에. 이 라벨 코퍼스가
정오탐 판별기의 실제 작동 여부를 판단하는 유일한 기준이다(works.any 데모에 속지 않기).

## 18. 제안 디렉토리 구조

```
js_anal_agent/
  core/src/
    ingest/          # [0][1] 수집·언번들·소스맵·beautify
    static/          # [2] AST/휴리스틱 테인트/자산/시크릿
    orchestrator/    # 코드 스케줄러 + 상태 스토어 + 캐시 + 예산
    agents/          # [3]-[8] 프롬프트 + 실행 + 스키마 검증
    rules/           # §15 클래스별 룰카드
    report/          # HTML/JSON/SARIF
    verify/          # [7.1] 활성 검증: PoC 러너(browser/http/url) + 아웃바운드 가드레일
    http/            # Local HTTP API(잡 큐)
    cli.ts
  burp/              # Java Montoya 확장(얇음, 활성 검증 시 Burp 경유)
  claude-code/       # skill/agent 래퍼 (+ 헤더 주입 Hook)
  corpus/            # 평가 코퍼스(라벨 포함)
  runs/  cache/      # 산출물·캐시(gitignore)
  js-analyzer.config.json # headers/cookies/proxy/scope 설정(canonical)
  DESIGN.md
```
