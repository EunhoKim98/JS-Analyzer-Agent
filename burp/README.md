# JS Analyzer — Burp Montoya 확장 (M5)

버프에 설치하는 **얇은 JAR**. 분석 로직은 없고, 번들된 코어 바이너리(M4)를 `serve`
모드(M2)로 띄워 로컬 HTTP로 위임한다.

## 동작

1. 우클릭 → **"Analyze JS (this host)"**
2. Burp sitemap에서 해당 호스트의 JS(URL+본문)를 시드로 수집 (중복은 코어 M3가 제거)
3. 번들 코어를 spawn → `POST /jobs` → 폴링 → `report.html`
4. Suite 탭 **"JS Analyzer"**에 결과 렌더. provider(SDK/Claude Code/Codex)와 SDK URL·토큰은 탭에서 설정.

## 빌드 (JDK 17+ 필요, 로컬에 JDK 없으면 CI가 빌드)

빌드 전에 코어를 `src/main/resources/core.zip` 으로 넣어야 한다:

```bash
# 1) 코어 바이너리 패키징 (레포 루트에서)
scripts/package-core.sh <bun-target>        # dist/core/ = 바이너리+rules+data

# 2) core.zip 으로 묶어 리소스에 배치
( cd dist/core && zip -r core.zip . )
mkdir -p burp/src/main/resources && cp dist/core/core.zip burp/src/main/resources/

# 3) JAR 빌드
cd burp && ./gradlew shadowJar -PappVersion=<X.Y.Z>
#   → burp/build/libs/js-analyzer-burp-<X.Y.Z>.jar
```

## 주의

- 코어 바이너리는 OS별로 다르므로 **OS별 JAR**을 낸다(설계 R4). `core.zip`에 담긴
  바이너리가 실행 OS와 일치해야 한다.
- 코어는 헤드리스 브라우저를 쓰지 않으므로(D7) 브라우저 동봉·설치가 필요 없다. 분석 입력은
  Burp history 시드(사용자가 브라우징한 트래픽)로 한정된다.
