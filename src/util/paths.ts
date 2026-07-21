import * as fs from 'fs';
import * as path from 'path';

// 리소스 디렉터리 해석 — rules/·data/ 를 런타임에 찾는다. 단일 바이너리로 패키징하면
// __dirname 이 가상 경로라 소스 상대 경로가 깨지므로, 아래 순서로 찾는다(M4):
//   1) 환경변수 override (JS_ANALYZER_RULES_DIR / JS_ANALYZER_DATA_DIR)
//   2) 실행 파일(process.execPath) 옆 — 패키징된 바이너리는 rules/·data/를 옆에 동봉
//   3) 소스 상대(__dirname/../..) — tsx/tsc 개발 실행
function resolveResourceDir(name: string, envVar: string): string {
  const override = process.env[envVar];
  if (override) return override;
  const beside = path.join(path.dirname(process.execPath), name);
  if (fs.existsSync(beside)) return beside;
  return path.resolve(__dirname, '../..', name);
}

export function rulesDir(): string {
  return resolveResourceDir('rules', 'JS_ANALYZER_RULES_DIR');
}

export function dataDir(): string {
  return resolveResourceDir('data', 'JS_ANALYZER_DATA_DIR');
}
