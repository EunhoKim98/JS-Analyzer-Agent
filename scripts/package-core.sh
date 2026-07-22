#!/usr/bin/env bash
# 코어 단일 바이너리 패키징(M4) — bun으로 src/cli.ts 를 자기완결형 실행파일로 컴파일하고
# 런타임 리소스(rules/·data/)를 옆에 동봉한다. Burp JAR(M5)이 이 산출물을 담아 배포한다.
#
# Usage: scripts/package-core.sh [bun-target] [outdir]
#   bun-target: bun-darwin-arm64 | bun-linux-x64 | bun-windows-x64 | (생략=현재 플랫폼)
#   outdir:     기본 dist/core
# (D7) 헤드리스 브라우저 미사용으로 바이너리는 완전 자기완결 — 브라우저 동봉 불필요.
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
  bun build src/cli.ts --compile --target="$TARGET" --outfile "$OUTDIR/$NAME"
else
  bun build src/cli.ts --compile --outfile "$OUTDIR/$NAME"
fi

echo "[package] copying runtime resources (rules/, data/)"
cp -r rules data "$OUTDIR/"

echo "[package] done → $OUTDIR/"
ls -lh "$OUTDIR"
