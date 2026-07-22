---
title: 아키텍처
nav_order: 5
description: 객체지향 코어 구조 — Pipeline / Stage / Agent / Provider.
---

# 아키텍처
{: .no_toc }

실행 코어는 객체지향 + SOLID 로 구성됩니다. `RunContext`(공유 상태)를 순서대로 스테이지에 통과시키는
파이프라인입니다.
{: .fs-5 .fw-300 }

1. TOC
{:toc}

---

## 실행 흐름

```
CLI(Cli/ArgParser)  또는  HTTP(JobStore/HttpServer)
  └─ runPipeline (합성 루트: 모든 협력자 생성·주입)
       └─ Pipeline.run(RunContext)
            [0] AcquireStage   ─ SourceAcquirer(Strategy) → FileIngestor | BrowserDiscoverer + seed dedupe
            [1] UnbundleStage  ─ Unbundler (소스맵 복원 / beautify)
            [2] StaticStage    ─ StaticAnalyzer(Facade) → SinkDetector · AssetExtractor · LibraryScanner
            [3] RouteStage     ─ 벤더=CVE경로 / 앱싱크=LLM, maxSinks 예산
            [5] AnalyzeStage   ─ AnalyzeAgent (OODA) · CodeSlicer · LlmProvider
            [7] JudgeStage     ─ JudgeAgent + DeterministicRecheck · LlmProvider
            [8] ReportStage    ─ HtmlReporter · AssetsExporter
```

## 설계 원칙

- **단일 책임(SRP)** — 클래스 하나는 한 가지 이유로만 바뀐다.
- **의존성 주입(DIP)** — 협력자는 생성자 주입. 전역 싱글턴 없음. 생성은 합성 루트 한 곳에.
- **개방-폐쇄(OCP)** — 취약점 클래스 = `rules/*.yaml` 카드 추가, 파이프라인 단계 = `PipelineStage` 구현 추가,
  LLM 백엔드 = `LlmProvider` 구현 추가. 오케스트레이터 코드는 불변.
- **다형성 > 분기** — 에이전트·스테이지·provider·취득 전략을 공통 인터페이스로 다룬다.
- **서비스는 객체, 순수 변환은 함수** — AST 헬퍼·중복제거·동시성 같은 순수 로직은 함수로 유지.

## 핵심 타입

| 경로 | 타입 | 책임 |
|---|---|---|
| `orchestrator/pipeline.ts` | `Pipeline`, `runPipeline` | 스테이지 조합 + 합성 루트 |
| `orchestrator/stages.ts` | `PipelineStage` 외 7개 | Chain-of-Responsibility |
| `orchestrator/context.ts` | `RunContext` | 스테이지 간 공유 상태 |
| `agents/provider.ts` | `LlmProvider` | LLM 백엔드 계약(Strategy) |
| `agents/{client,providers/*}` | sdk / claude-cli / codex | provider 구현 + 팩토리 |
| `static/index.ts` | `StaticAnalyzer` | 정적 프리패스 Facade |
| `ingest/{acquire,dedupe}.ts` | `SourceAcquirer`, `dedupeFiles` | 취득 전략 + 중복제거 |
| `http/{jobs,server}.ts` | `JobStore`, `HttpServer` | 로컬 잡 API |
| `report/{html,json}.ts` | `HtmlReporter`, `AssetsExporter` | 리포트 산출 |

## 산출물

한 실행 = `runs/<run_id>/` 디렉터리 하나. `RunStore`가 관리: `sinks.json` · `asset_manifest.json` ·
`libraries.json` · `findings.jsonl` · `verdicts.json` · `assets_export.json` · `report.html` · `meta.json` ·
`reconstructed/` · `trace/`.
