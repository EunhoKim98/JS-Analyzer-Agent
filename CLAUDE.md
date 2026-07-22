# CLAUDE.md

이 파일은 이 저장소에서 코드를 작업할 때 Claude Code(및 사람 기여자)가 따라야 할
아키텍처와 설계 원칙을 정리한다. 제품 개념·파이프라인 단계 설명은 [`README.md`](./README.md)와
[`DESIGN.md`](./DESIGN.md)에 있고, 여기서는 **"어떻게 구현되어 있는가(객체지향 구조와 원칙)"**를 다룬다.

## 빌드 · 실행

```bash
npm install            # 의존성 설치 (Playwright 제거됨 — 브라우저 설치 불필요, D7)
npm run build          # tsc → dist/
npm run dev -- analyze samples/vulnerable.js --no-llm   # tsx로 소스 직접 실행
node dist/cli.js analyze <file|dir|url> [--no-llm] [--max-sinks K] [--config path] [--out dir]
```

- 타입 체크만: `./node_modules/.bin/tsc --noEmit`
- 스모크 테스트(무API): `npm run dev -- analyze samples/vulnerable.js --no-llm --out /tmp/out`

## 설계 원칙 (이 코드베이스의 규칙)

실행 코드는 **객체지향 + SOLID + 실용주의**를 기준으로 작성한다. 새 코드도 아래를 따른다.

1. **단일 책임(SRP)** — 클래스 하나는 한 가지 이유로만 바뀐다. 예: `SinkDetector`(탐지),
   `AssetExtractor`(자산 추출), `LibraryScanner`(CVE 매칭)는 각각 독립적이고, `StaticAnalyzer`가
   이들을 조합(Facade)만 한다.
2. **의존성 역전/주입(DIP)** — 협력자는 `new` 로 안에서 만들지 말고 **생성자 주입**한다.
   전역 싱글턴/모듈 캐시를 두지 않는다(과거 `cachedAuth`·`client`·`DB` 전역을 인스턴스 필드로
   전환함). 모든 객체 생성은 **합성 루트**(`orchestrator/pipeline.ts`의 `runPipeline`)에 모은다.
3. **개방-폐쇄(OCP)** — 기능 확장은 코드 수정이 아니라 **추가**로 한다.
   - 취약점 클래스 추가 = `rules/*.yaml` 카드 추가 (코드 불변).
   - 파이프라인 단계 추가/재배열 = `PipelineStage` 구현체를 `runPipeline`의 배열에 넣기만.
   - LLM 에이전트 추가 = `Agent<In,Out>` 구현. 오케스트레이터는 인터페이스에만 의존.
4. **다형성 > 분기** — 에이전트·스테이지·취득 전략은 공통 인터페이스(`Agent`, `PipelineStage`,
   `Acquirer` 역할)로 다룬다. `if (type === ...)` 대신 객체 교체로 동작을 바꾼다.
5. **"서비스는 객체, 순수 변환은 함수"** — 모든 것을 클래스로 감싸지 않는다. 상태·의존성이 없는
   순수 함수(예: `util/concurrency.ts`의 `mapLimit`, `ast.ts`의 AST 헬퍼, 버전 비교)는 함수로 둔다.
   이는 도그마가 아니라 판단이며, 억지 클래스화를 피하는 것도 원칙이다.
6. **결정론 우선** — 정적/규칙 기반 계층은 API 키 없이도 동작하고 재현 가능해야 한다.
   LLM 실패는 예외를 던지지 말고 **degrade**(정적 폴백/`needs_review`)로 처리한다.
7. **한글 주석** — 새로 만든 핵심 클래스 상단에는 어떤 책임을 지며 어떤 원칙을 적용했는지
   한글 주석을 단다. 기존 인라인 설명 주석은 영어를 유지한다(일관성).

## 문서 동기화 규칙 (코드 변경 시 필수)

**코드를 변경하면, 그 작업의 마지막 단계로 관련 문서까지 반드시 갱신한다.** 코드와 문서가
어긋난 채로 커밋/푸시하지 않는다. 이는 선택이 아니라 완료 조건(Definition of Done)이다.

- **대상 문서**: 변경이 닿는 범위에 따라 아래를 점검·갱신한다.
  - `README.md` — 사용법·설치·플래그·획득 경로·커버리지가 바뀌면.
  - `DESIGN.md` — 아키텍처·파이프라인 단계·마일스톤·설계 결정(Dx)이 바뀌면.
  - `CLAUDE.md`(이 파일) — 디렉터리/핵심 클래스 지도, 설계 원칙, 불변식이 바뀌면.
  - `docs/*.md` (GitHub Pages) — `pipeline.md`·`providers.md`·`usage.md`·`architecture.md`·
    `roadmap.md`·`burp.md` 중 해당 주제가 바뀌면. **특히 `pipeline.md`의 단계별 설명은
    실제 스테이지 동작과 반드시 일치해야 한다.**
- **일관성 체크**: 기능을 제거/변경하면 `grep -rin "<옛기능>"`으로 문서 잔재를 찾아 함께 정리한다.
  (예: Playwright 제거 시 모든 "현재 동작" 서술을 D7 기준으로 갱신.)
- **미래/로드맵 서술 구분**: 아직 구현 안 된 기능은 "현재 동작"으로 쓰지 말고 마일스톤/옵션임을
  명시한다. 제거된 기능을 미래 계획으로 남길 땐 근거(Dx)를 링크한다.
- **커밋 메시지**: 코드+문서를 함께 커밋하거나, 문서 갱신 커밋을 같은 PR/브랜치에 포함한다.

## 아키텍처 개요

`analyze` 실행은 `RunContext`(공유 상태 객체)를 순서대로 스테이지에 통과시키는 **파이프라인**이다.
각 스테이지는 이전 결과를 읽고 자기 산출물을 컨텍스트에 덧붙인다.

```
CLI(Cli/ArgParser)
  └─ runPipeline (합성 루트: 모든 협력자 생성·주입)
       └─ Pipeline.run(RunContext)
            [0] AcquireStage   ─ SourceAcquirer → FileIngestor + seed(dedupe). Playwright 제거(D7)
            [1] UnbundleStage  ─ Unbundler (소스맵 복원 / beautify)
            [2] StaticStage    ─ StaticAnalyzer(Facade) → SinkDetector · AssetExtractor · LibraryScanner
            [3] RouteStage     ─ 벤더=CVE경로 / 앱싱크=LLM, maxSinks 예산 적용
            [5] AnalyzeStage   ─ AnalyzeAgent (OODA, Sonnet) · CodeSlicer
            [7] JudgeStage     ─ JudgeAgent (FP판정, Opus) + DeterministicRecheck
            [8] ReportStage    ─ HtmlReporter · AssetsExporter → report.html/json/meta
```

LLM 계층은 `LlmClient`가 담당하고, 인증 해석은 `AuthResolver`가 캡슐화해 생성자 주입된다.
`RunStore`는 실행별 산출물 디렉터리(raw/reconstructed/trace + json/jsonl)를 관리한다.

## 디렉터리 · 핵심 클래스 지도

| 경로 | 핵심 타입 | 책임 · 적용 패턴 |
|---|---|---|
| `src/cli.ts` | `Cli`, `ArgParser` | 인자 파싱/사용법/결과 출력 (SRP 분리) |
| `src/orchestrator/pipeline.ts` | `Pipeline`, `runPipeline` | 스테이지 조합 실행 + **합성 루트**(DIP) |
| `src/orchestrator/stages.ts` | `PipelineStage` 및 7개 스테이지 | Chain-of-Responsibility, 각 스테이지 SRP |
| `src/orchestrator/context.ts` | `RunContext`, `RunOptions`, `RunResult` | Context Object — 스테이지 간 공유 상태 |
| `src/orchestrator/store.ts` | `RunStore` | 실행별 파일 저장소 |
| `src/ingest/acquire.ts` | `SourceAcquirer` | 취득 전략 선택 (Strategy) |
| `src/ingest/index.ts` | `FileIngestor`, `contentHash()` | 파일·디렉터리·URL 인제스트 |
| `src/ingest/dedupe.ts` | `dedupeFiles()` | 시드 JS 중복 제거(내용 해시 동일=1개, 이름 충돌 disambiguate). 순수→함수 |
| `src/http/{jobs,server,live}.ts` | `JobStore`·`HttpServer`·`buildLiveHtml` | 로컬 잡 API + SSE 스트림 + 라이브 웹 UI (D8) |
| `src/static/index.ts` | `StaticAnalyzer` | 정적 프리패스 Facade + 싱크 랭킹 |
| `src/static/ast.ts` | `SinkDetector` (+ 순수 AST 헬퍼) | Babel AST 싱크/소스/새니타이저 탐지 |
| `src/static/assets.ts` | `AssetExtractor` | 경로·URL·파라미터·시크릿 추출 |
| `src/static/libraries.ts` | `LibraryScanner` | retire.js 지문 + CVE 매칭 (전역 DB 제거) |
| `src/static/rules.ts` | `RuleRepository` | 룰 카드 로드·조회 (Repository) |
| `src/static/unbundle.ts` | `Unbundler` | 소스맵 복원 / beautify |
| `src/agents/provider.ts` | `LlmProvider`, `CallOpts`, `ProviderKind` | LLM 백엔드 공통 계약(Strategy) — 파이프라인은 이 인터페이스에만 의존 (D4) |
| `src/agents/providers/factory.ts` | `createLlmProvider()` | 종류(sdk/claude-cli/codex)→provider 생성. 합성 루트에서만 호출 |
| `src/agents/providers/cli-base.ts` | `CliProvider` | 로컬 CLI(`claude -p`·`codex exec`) 호출+스키마 재시도 베이스, 실패 시 null degrade |
| `src/agents/providers/{claude-cli,codex}.ts` | `ClaudeCliProvider`, `CodexProvider` | `CliProvider` 구체화(명령·인자만 지정) |
| `src/agents/client.ts` | `AuthResolver`, `LlmClient` | 인증 해석 + 엄격 JSON LLM 호출(SDK provider, `LlmProvider` 구현) (DIP) |
| `src/agents/agent.ts` | `Agent<In,Out>`, `LlmAgent` | 에이전트 공통 계약·베이스 |
| `src/agents/analyze.ts` | `AnalyzeAgent` | OODA 분석 에이전트 |
| `src/agents/judge.ts` | `JudgeAgent`, `DeterministicRecheck` | FP 판정 + 결정론적 재확인 |
| `src/agents/prompts.ts` | 프롬프트 빌더 함수 | 순수 문자열 생성(함수 유지) |
| `src/report/html.ts` | `HtmlReporter` | HTML 리포트 렌더링 |
| `src/report/json.ts` | `AssetsExporter`, `AssetsExport` | 자산 JSON 익스포트 |
| `src/config.ts` | `ConfigLoader` | 기본값+파일 병합 |
| `src/util/` | `CodeSlicer`, `mapLimit` | 슬라이싱(상태 有→클래스), 동시성(순수→함수) |

## 코드를 확장할 때

- **취약점 클래스 추가**: `rules/<class>.yaml` 카드만 추가한다. 탐지기 코드는 카드 기반이라 대개 불변.
  (새 `detector` 종류가 필요하면 `SinkDetector`에 케이스를 추가하고 `RuleCard` 타입을 확장.)
- **파이프라인 단계 추가**: `PipelineStage`를 구현하고 `runPipeline`의 스테이지 배열에 끼워 넣는다.
  필요한 협력자는 합성 루트에서 생성해 생성자로 주입한다.
- **새 LLM 에이전트**: `LlmAgent`를 상속하고 `Agent<In,Out>`를 구현한다. `LlmProvider`는 재사용한다.
- **새 LLM 백엔드(provider)**: `LlmProvider`를 구현(CLI류면 `CliProvider` 상속)하고 `ProviderKind`와
  `createLlmProvider()` 스위치에 케이스를 추가한다. 파이프라인/에이전트 코드는 불변(OCP).
- **새 취득 소스**: `SourceAcquirer`에 전략 축을 추가하거나 별도 `Acquirer` 구현을 주입한다.

## 불변식 · 주의점

- **전역 가변 상태 금지**: 캐시가 필요하면 인스턴스 필드로. 협력자는 주입받는다.
- **LLM 호출은 항상 degrade 가능해야 함**: `LlmClient.callJSON`은 실패 시 `null`을 반환하고,
  스테이지/에이전트는 정적 폴백 또는 `needs_review`로 이어간다. 파이프라인을 죽이지 않는다.
- **미니파이 대비**: 코드 슬라이스는 `CodeSlicer`가 줄·전체 길이를 반드시 제한한다(토큰 폭증 방지).
- **결정성**: 타깃 모델은 temperature를 받지 않으므로 보내지 않는다. 재현성은 정적 계층이 보장한다.
- `dist/`·`runs/`·`node_modules/`는 `.gitignore` 대상 — 커밋하지 않는다.
