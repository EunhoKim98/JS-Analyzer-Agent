import { IngestedFile } from '../types';

// 수집된 JS 파일 중복 제거(전처리) — Burp history는 같은 JS URL이 여러 요청에 반복
// 등장하고, 다른 URL에 동일 본문(CDN 미러/버전 URL)도 흔하다. 순수 함수라 함수로 유지.
//
// 규칙:
//  1) contentHash가 같으면 동일 파일 → 첫 번째만 유지(내용이 같으면 URL이 달라도 1개).
//  2) 이름이 겹치는데 내용이 다르면 이름을 disambiguate(`name~2`) — 파이프라인의
//     codeByFile Map(파일명→코드)이 서로 덮어쓰지 않도록 보장.
export function dedupeFiles(files: IngestedFile[]): IngestedFile[] {
  const seenHash = new Set<string>();
  const usedNames = new Set<string>();
  const out: IngestedFile[] = [];

  for (const f of files) {
    if (seenHash.has(f.contentHash)) continue; // identical content already kept
    seenHash.add(f.contentHash);

    let name = f.file;
    if (usedNames.has(name)) {
      let i = 2;
      while (usedNames.has(`${name}~${i}`)) i++;
      name = `${name}~${i}`;
    }
    usedNames.add(name);
    out.push(name === f.file ? f : { ...f, file: name });
  }
  return out;
}
