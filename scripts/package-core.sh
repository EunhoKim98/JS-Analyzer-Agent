#!/usr/bin/env bash
# 코어 단일 바이너리 패키징(M4) — bun으로 src/cli.ts 를 자기완결형 실행파일로 컴파일하고
# 런타임 리소스(rules/·data/)를 옆에 동봉한다. Burp JAR(M5)이 이 산출물을 담아 배포한다.
#
# Usage: scripts/package-core.sh [bun-target] [outdir]
#   bun-target: bun-darwin-arm64 | bun-linux-x64 | bun-windows-x64 | (생략=현재 플랫폼)
#   outdir:     기본 dist/core
#
# 주의: chromium-bidi 는 Playwright의 선택적(firefox/bidi) 의존이라 미설치 → external 처리.
#       Chromium 브라우저 자체는 바이너리에 못 담으므로 대상 호스트에서 `playwright install`
#       또는 시스템 크로미움 재사용 필요(설계 R2). 순수 파이프라인+HTTP는 바이너리만으로 동작.
set -euo pipefail

TARGET="${1:-}"
OUTDIR="${2:-dist/core}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="js-analyzer-core"
case "$TARGET" in
  *windows*) NAME="js-analyzer-core.exe" ;;
esac

mkdir -p "$OUTDIR"

echo "[package] compiling $NAME ${TARGET:+($TARGET)}"
if [ -n "$TARGET" ]; then
  bun build src/cli.ts --compile --target="$TARGET" --external chromium-bidi --outfile "$OUTDIR/$NAME"
else
  bun build src/cli.ts --compile --external chromium-bidi --outfile "$OUTDIR/$NAME"
fi

echo "[package] copying runtime resources (rules/, data/)"
cp -r rules data "$OUTDIR/"

echo "[package] done → $OUTDIR/"
ls -lh "$OUTDIR"
