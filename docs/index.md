---
title: 개요
nav_order: 1
description: 결정론적 정적분석이 후보를 좁히고, LLM 에이전트가 그것만 추론한다.
---

# JS Analyzer Agent
{: .fs-9 }

결정론적 정적분석이 후보를 좁히고, **LLM 에이전트**가 그것만 추론한다.
{: .fs-6 .fw-300 }

[GitHub 저장소 ↗](https://github.com/EunhoKim98/JS-Analyzer-Agent){: .btn .btn-primary .mr-2 }
[사용법]({{ '/usage.html' | relative_url }}){: .btn }

---

웹페이지·번들 자바스크립트에서 취약점을 찾는 멀티 에이전트 솔루션. 값싸고 반복 가능한 정적 분석으로
의심 지점(sink)을 먼저 추려낸 뒤, LLM은 순위가 매겨진 후보에 대해서만 OODA 추론과 오탐 판정을 수행합니다.
순수 LLM 스캔보다 정밀하고, 순수 정적 분석보다 문맥을 이해합니다.

| 구성 | 값 |
|---|---|
| 형태 | CLI · 로컬 HTTP API · **Burp 확장(진행 중)** |
| 코어 | TypeScript (OOP) |
| 엔진 | Babel AST (헤드리스 브라우저 없음, D7) |
| LLM | Claude SDK / Claude Code (`claude -p`) / Codex — **선택형** |

## 무엇을 푸는 솔루션인가

현대 웹 프런트엔드는 번들링·난독화된 대용량 자바스크립트로 배포됩니다. 사람이 일일이 읽기 어렵고,
LLM에 통째로 넣으면 비싸고 부정확합니다. JS Analyzer Agent는 **"먼저 값싸게 좁히고, 비싼 추론은
후보에만"** 이라는 원칙으로 이 문제를 나눕니다. 파일·디렉터리·URL을 입력하면 취약점 후보를 찾아
분석하고, 사람이 읽는 HTML 리포트와 기계가 읽는 JSON을 `runs/<run_id>/`에 남깁니다.

## 핵심 컨셉

| | 단계 | 설명 |
|---|---|---|
| **A** | 정적 프리패스 | AST로 source·sink·sanitizer를 찾고 휴리스틱 테인트로 위험 지점을 순위화. LLM 호출 없이 어디서든 실행되는 결정론적 단계. |
| **B** | 에이전트 추론 | 순위가 매겨진 sink마다 한 번의 OODA 라운드로 실제 도달 가능성·악용 경로를 분석. 코드 전체가 아닌 후보에만 집중. |
| **C** | 오탐 판정 | 각 finding을 재검토해 false positive를 걸러내고, 결정론적 recheck로 판정을 교차 검증. 신뢰도 높은 결과만 남김. |
| **D** | 데이터 기반 규칙 | 취약점 클래스는 `rules/*.yaml` 카드로 정의. 클래스 추가 = 카드 추가. 코드 수정 없이 커버리지 확장. |

## 커버리지 (v0.1 시드)

DOM-XSS · open redirect · postMessage(origin 검증 누락) · 프로토타입 오염(휴리스틱) · 하드코딩 시크릿(공개키 분류).
새 클래스 추가 = `rules/*.yaml` 카드 추가.

---

왼쪽 사이드바로 파이프라인, provider 선택, Burp 확장, 아키텍처, 사용법, 로드맵을 탐색하세요.
