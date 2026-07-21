import { IngestedFile, SinkRecord, AssetRecord, SeverityHint, LibraryFinding } from '../types';
import { SinkDetector } from './ast';
import { AssetExtractor } from './assets';
import { LibraryScanner } from './libraries';
import { RuleRepository } from './rules';

export { RuleRepository } from './rules';
export { LibraryScanner } from './libraries';
export { SinkDetector } from './ast';
export { AssetExtractor } from './assets';

export interface StaticResult {
  sinks: SinkRecord[];
  assets: AssetRecord[];
  libraries: LibraryFinding[];
}

const SEV_ORDER: Record<SeverityHint, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};
const GRADE_ORDER: Record<string, number> = { direct: 0, aliased: 1, sink_only: 2 };

// Filename heuristics for third-party/library bundles (routed to the CVE path,
// not per-sink LLM analysis) — plus any file where a library was fingerprinted.
const VENDOR_RE = /(^|[-_./])(vendor|runtime|polyfill|chunk-vendors|node_modules|lib|libs|bundle-deps)([-_./]|$)/i;

// 정적 분석 파사드(Facade) — 싱크 탐지·자산 추출·라이브러리 스캔이라는 세 협력자를
// 하나의 인터페이스로 묶고, 결과 싱크를 (소스 유무 → 경로 등급 → 심각도) 순으로
// 랭킹한다(Stage [2]). 파이프라인은 이 파사드 하나에만 의존한다(SRP·낮은 결합도).
export class StaticAnalyzer {
  private readonly detector: SinkDetector;
  private readonly assetExtractor: AssetExtractor;
  private readonly libraryScanner: LibraryScanner;

  constructor(rules: RuleRepository, dataDir?: string) {
    this.detector = new SinkDetector(rules.all);
    this.assetExtractor = new AssetExtractor(rules.all);
    this.libraryScanner = LibraryScanner.load(dataDir);
  }

  analyze(files: IngestedFile[]): StaticResult {
    const sinks: SinkRecord[] = [];
    const assets: AssetRecord[] = [];

    for (const f of files) {
      sinks.push(...this.detector.detect(f.code, f.file));
      assets.push(...this.assetExtractor.extract(f.code, f.file));
    }
    const libraries = this.libraryScanner.scan(files);

    sinks.sort((a, b) => {
      // On minified bundles almost everything degenerates to sink_only, so the
      // presence of an identified source is a FAR stronger signal than the class's
      // nominal severity. Rank: has-source → path grade → severity.
      const src = (a.source.found ? 0 : 1) - (b.source.found ? 0 : 1);
      if (src !== 0) return src;
      const g = GRADE_ORDER[a.path_grade] - GRADE_ORDER[b.path_grade];
      if (g !== 0) return g;
      return SEV_ORDER[a.severity_hint] - SEV_ORDER[b.severity_hint];
    });

    return { sinks, assets, libraries };
  }

  // A file is "library/vendor" if its name matches the vendor heuristic or a
  // library was fingerprinted in it → routed to the CVE path, not per-sink LLM.
  static isLibraryFile(file: string, libraries: LibraryFinding[]): boolean {
    if (VENDOR_RE.test(file)) return true;
    return libraries.some((l) => l.file === file);
  }
}
