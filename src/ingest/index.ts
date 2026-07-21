import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IngestedFile } from '../types';

// 콘텐츠 해시 — 순수 함수이므로 클래스가 아니라 함수로 유지한다.
export function contentHash(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
}

// 파일 인제스터 — 파일·디렉터리·URL(원시 fetch)을 원시 JS 파일 목록으로 해석한다.
// 브라우저 페이지 탐색과는 분리된 전략의 한 축이다(SRP; SourceAcquirer가 조합).
export class FileIngestor {
  async ingest(target: string): Promise<IngestedFile[]> {
    if (/^https?:\/\//i.test(target)) {
      return [await this.ingestUrl(target)];
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) return this.ingestDir(target);
    return [this.ingestFile(target)];
  }

  private ingestFile(file: string): IngestedFile {
    const code = fs.readFileSync(file, 'utf8');
    return { file: path.basename(file), code, origin: 'raw', contentHash: contentHash(code) };
  }

  private ingestDir(dir: string): IngestedFile[] {
    const out: IngestedFile[] = [];
    for (const entry of FileIngestor.walk(dir)) {
      if (/\.(js|mjs|cjs)$/i.test(entry)) {
        const code = fs.readFileSync(entry, 'utf8');
        out.push({ file: path.relative(dir, entry), code, origin: 'raw', contentHash: contentHash(code) });
      }
    }
    return out;
  }

  private static *walk(dir: string): Generator<string> {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) yield* FileIngestor.walk(full);
      else yield full;
    }
  }

  private async ingestUrl(url: string): Promise<IngestedFile> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const code = await res.text();
    const name = new URL(url).pathname.split('/').pop() || 'remote.js';
    return { file: name, code, origin: 'raw', contentHash: contentHash(code) };
  }
}
