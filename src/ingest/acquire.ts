import * as fs from 'fs';
import * as path from 'path';
import { IngestedFile } from '../types';
import { FileIngestor, contentHash } from './index';
import { dedupeFiles } from './dedupe';
import { SeedFile } from '../orchestrator/context';

export interface AcquireOptions {
  seedFiles?: SeedFile[]; // external JS seed (Burp history) — the primary input (D7)
}

export interface AcquisitionResult {
  files: IngestedFile[]; // acquired JS (deduped)
  acquisition: string; // how it was acquired (for meta/reporting)
  targetDir?: string; // local dir for sourcemap resolution (undefined for URLs)
}

// 소스 취득기 — "어디서 JS를 가져올지"를 결정한다(D7). 헤드리스 브라우저 자동 크롤링은
// 쓰지 않고, 입력은 (1) Burp history 등 외부 시드 + (2) 파일·디렉터리·직접 `.js` fetch 뿐이다.
// 사용자가 실제 만진 트래픽만 분석한다는 Burp 철학에 맞추고, 브라우저 의존을 없앤다.
export class SourceAcquirer {
  constructor(private readonly fileIngestor: FileIngestor = new FileIngestor()) {}

  async acquire(target: string, opts: AcquireOptions): Promise<AcquisitionResult> {
    const isUrl = /^(https?|file):/i.test(target);
    const hasSeed = !!opts.seedFiles?.length;

    // Seed from Burp history (D7): the primary set.
    const seed: IngestedFile[] = (opts.seedFiles || []).map((s) => ({
      file: s.name,
      code: s.code,
      origin: 'raw',
      contentHash: contentHash(s.code),
    }));

    // Ingest the target directly only when there's no seed, or it's a local path.
    // (With a seed + URL host, the seed IS the input — no page load, no crawling.)
    let direct: IngestedFile[] = [];
    if (!hasSeed || !isUrl) {
      direct = await this.fileIngestor.ingest(target);
    }

    // Preprocess: dedupe the union (Burp history repeats the same JS often).
    const files = dedupeFiles([...seed, ...direct]);
    if (!files.length) console.error('[acquire] no JS acquired (empty seed and nothing at target)');

    const targetDir = isUrl
      ? undefined
      : fs.statSync(target).isDirectory()
        ? target
        : path.dirname(target);

    const acquisition = hasSeed ? (direct.length ? 'seed + direct' : 'seed (interaction)') : 'direct';
    return { files, acquisition, targetDir };
  }
}
