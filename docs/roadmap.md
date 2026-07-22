---
title: 로드맵
nav_order: 7
description: 마일스톤 진행 상황.
---

# 로드맵
{: .no_toc }

파이프라인 번호의 공백 `3·4·6`은 다음 마일스톤 자리입니다: explore/asset/chaining 에이전트, 능동 PoC 검증.
{: .fs-5 .fw-300 }

1. TOC
{:toc}

---

## v0.1 — 코어 (완료)

`[0][1][2]` 결정론(언번들+정적) + `[5]` OODA 분석 + `[7]` 오탐 판정 + `[8]` HTML/JSON 리포트. CLI.

## 코어 진화 (완료)

객체지향 리팩터 위에 얹은 실측 완료 항목:

| 항목 | 내용 | 상태 |
|---|---|---|
| OOP 리팩터 | Pipeline/Stage/Agent/Provider/Reporter | ✅ |
| Provider 추상화 | sdk / claude-cli / codex + `--provider` | ✅ 실측 |
| 로컬 HTTP 잡 API | `serve` (POST/poll/report) | ✅ 실측 |
| Seed + 중복제거 | Burp history 시드 · content-hash dedupe | ✅ 실측 |
| 단일 바이너리 | bun `--compile` + 리소스 동봉 | ✅ 실측 |

## Burp 확장 (v1.0, 진행 중)

| 항목 | 상태 |
|---|---|
| Java Montoya 확장 스캐폴딩(`burp/`) | 🟡 CI 빌드 대기 |
| Release CI (태그 → OS별 JAR → Releases) | ✅ 워크플로우 · 첫 실행 대기 |
| 헤드리스 브라우저 자동 수집 제거 (사용자 인터렉션 트래픽만) | ✅ 실측 (D7) |
| SSE 스트리밍 + 라이브 웹 UI | ✅ 실측 (D8) |
| Java 확장 브라우저 열기 (폴링/Swing 제거) | 🟡 CI 컴파일 대기 |

자세히는 [Burp 확장]({{ '/burp.html' | relative_url }}) 참고.

## 이후 마일스톤

- **[3] 탐색 / [4] 자산 에이전트** — 모듈 우선순위화, regex 후보 문맥 검증.
- **[6] 체이닝** — findings·자산 종합, 취약점 연결 시나리오.
- **능동 PoC 검증** — 헤드리스 브라우저 PoC 러너 + 아웃바운드 가드레일 (기본 OFF).
- **평가 코퍼스** — 라벨 번들로 precision/recall 추적.
