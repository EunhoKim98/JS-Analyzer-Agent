import { IngestedFile, RuleCard, SinkRecord, AssetRecord, SeverityHint, LibraryFinding } from '../types';
import { detectSinks } from './ast';
import { extractAssets } from './assets';
import { scanLibraries } from './libraries';

export { loadRules } from './rules';
export { scanLibraries } from './libraries';

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

export function isLibraryFile(file: string, libraries: LibraryFinding[]): boolean {
  if (VENDOR_RE.test(file)) return true;
  return libraries.some((l) => l.file === file);
}

// Stage [2]: detection + asset extraction + library fingerprint, then rank sinks
// by (has-source → grade → severity).
export function runStaticPrepass(files: IngestedFile[], rules: RuleCard[], dataDir?: string): StaticResult {
  const sinks: SinkRecord[] = [];
  const assets: AssetRecord[] = [];

  for (const f of files) {
    sinks.push(...detectSinks(f.code, f.file, rules));
    assets.push(...extractAssets(f.code, f.file, rules));
  }
  const libraries = scanLibraries(files, dataDir);

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
