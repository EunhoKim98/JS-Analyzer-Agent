import * as fs from 'fs';
import * as path from 'path';
import { IngestedFile } from '../types';
import { FileIngestor, contentHash } from './index';
import { BrowserDiscoverer } from './browser';
import { dedupeFiles } from './dedupe';
import { SeedFile } from '../orchestrator/context';

export interface AcquireOptions {
  browser?: boolean; // force Playwright page discovery
  noBrowser?: boolean; // force raw fetch even for a page URL
  scopeHosts?: string[]; // extra in-scope hosts for discovery
  allHosts?: boolean; // include third-party JS in discovery
  seedFiles?: SeedFile[]; // external JS seed (Burp history) — deduped, then Playwright fills gaps
}

export interface AcquisitionResult {
  files: IngestedFile[]; // raw acquired JS
  usedBrowser: boolean; // whether page discovery was used (for meta/reporting)
  targetDir?: string; // local dir for sourcemap resolution (undefined for URLs)
}

// 소스 취득기 — "어디서 JS를 가져올지"를 결정하는 전략 선택기(Strategy 패턴).
// 대상이 페이지 URL이면 브라우저 탐색을, .js/파일/디렉터리면 직접 인제스트를 고른다
// (DESIGN.md §4.11). 이 결정 로직을 파이프라인 본문에서 분리해 캡슐화했다(SRP).
export class SourceAcquirer {
  constructor(
    private readonly fileIngestor: FileIngestor = new FileIngestor(),
    private readonly browserDiscoverer: BrowserDiscoverer = new BrowserDiscoverer(),
  ) {}

  async acquire(target: string, opts: AcquireOptions): Promise<AcquisitionResult> {
    const isUrl = /^(https?|file):/i.test(target);
    const isJsUrl = /\.m?js(\?|#|$)/i.test(target);
    const useBrowser = !opts.noBrowser && (!!opts.browser || (isUrl && !isJsUrl));
    const hasSeed = !!opts.seedFiles?.length;

    // Seed from Burp history (D5): becomes the base set before gap-fill.
    const seed: IngestedFile[] = (opts.seedFiles || []).map((s) => ({
      file: s.name,
      code: s.code,
      origin: 'raw',
      contentHash: contentHash(s.code),
    }));

    // Discovery fills the gaps the seed doesn't cover.
    let discovered: IngestedFile[] = [];
    if (isUrl && useBrowser) {
      discovered = await this.browserDiscoverer.discover(target, {
        scopeHosts: opts.scopeHosts,
        allHosts: opts.allHosts,
      });
    } else if (!hasSeed || !isUrl) {
      // With a seed + page URL and no browser, the seed is the whole input.
      discovered = await this.fileIngestor.ingest(target);
    }

    // Preprocess: dedupe the union (Burp history repeats the same JS often).
    const files = dedupeFiles([...seed, ...discovered]);
    if (!files.length) console.error('[acquire] no JS acquired (seed empty and no in-scope JS found)');

    const targetDir = isUrl
      ? undefined
      : fs.statSync(target).isDirectory()
        ? target
        : path.dirname(target);

    return { files, usedBrowser: isUrl && useBrowser, targetDir };
  }
}
