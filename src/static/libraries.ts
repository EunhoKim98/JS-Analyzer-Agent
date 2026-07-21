import * as fs from 'fs';
import * as path from 'path';
import { IngestedFile, LibraryFinding, LibVuln } from '../types';

// Library fingerprint + CVE matching using the retire.js signature DB
// (DESIGN.md §5 / §15 supply-chain). Known libraries in a bundle are identified
// by version and matched to CVEs deterministically — no per-sink LLM.

interface VersionRange {
  atOrAbove?: string;
  above?: string;
  below?: string;
  atOrBelow?: string;
}
interface RetireVuln extends VersionRange {
  ranges?: VersionRange[]; // newer retire format nests bounds here
  severity?: string;
  identifiers?: { CVE?: string[]; summary?: string; [k: string]: unknown };
  info?: string[];
}
interface RetireComponent {
  vulnerabilities?: RetireVuln[];
  extractors?: { filecontent?: string[]; filename?: string[]; uri?: string[] };
}

const VER = '[0-9][0-9.a-z_\\-]+';

// 라이브러리 스캐너 — retire.js 시그니처 DB를 인스턴스 필드로 보관한다.
// 예전의 모듈 전역 `DB` 캐시(전역 가변 상태)를 제거하고, DB 로딩을 생성자에서
// 한 번 수행해 캡슐화했다(SRP; 테스트 시 시그니처 주입도 용이).
export class LibraryScanner {
  private constructor(private readonly db: Record<string, RetireComponent>) {}

  static load(dataDir?: string): LibraryScanner {
    const p = path.resolve(dataDir || path.resolve(__dirname, '../../data'), 'retire-signatures.json');
    const db = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, RetireComponent>) : {};
    return new LibraryScanner(db);
  }

  scan(files: IngestedFile[]): LibraryFinding[] {
    const out: LibraryFinding[] = [];
    const seen = new Set<string>();

    for (const f of files) {
      for (const [comp, def] of Object.entries(this.db)) {
        if (!def || typeof def !== 'object' || !def.extractors) continue;
        const contentPats = def.extractors.filecontent || [];
        const namePats = def.extractors.filename || def.extractors.uri || [];
        const version = LibraryScanner.firstVersion(contentPats, f.code) || LibraryScanner.firstVersion(namePats, f.file);
        if (!version) continue;
        const key = `${f.file}|${comp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          component: comp,
          version,
          file: f.file,
          vulnerabilities: LibraryScanner.vulnsFor(def.vulnerabilities || [], version),
        });
      }
    }
    return out;
  }

  private static firstVersion(patterns: string[], text: string): string | null {
    for (const pat of patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pat.replace(/§§version§§/g, VER));
      } catch {
        continue;
      }
      const m = re.exec(text);
      if (!m) continue;
      for (let i = 1; i < m.length; i++) {
        if (m[i] && /^[0-9]+(\.[0-9]+)/.test(m[i])) return m[i];
      }
    }
    return null;
  }

  private static vulnsFor(vulns: RetireVuln[], version: string): LibVuln[] {
    const out: LibVuln[] = [];
    for (const v of vulns) {
      const ranges = v.ranges && v.ranges.length ? v.ranges : [v];
      if (!ranges.some((r) => LibraryScanner.rangeMatch(version, r))) continue;
      out.push({
        severity: v.severity || 'unknown',
        cve: v.identifiers?.CVE || [],
        summary: v.identifiers?.summary,
        info: v.info || [],
        ranges: ranges.map(LibraryScanner.rangeStr).filter(Boolean).join(' | '),
      });
    }
    return out;
  }

  private static rangeMatch(version: string, r: VersionRange): boolean {
    // A range with no bounds at all matches nothing (avoid flagging every version).
    if (!r.atOrAbove && !r.above && !r.below && !r.atOrBelow) return false;
    if (r.atOrAbove && LibraryScanner.cmp(version, r.atOrAbove) < 0) return false;
    if (r.above && LibraryScanner.cmp(version, r.above) <= 0) return false;
    if (r.below && LibraryScanner.cmp(version, r.below) >= 0) return false;
    if (r.atOrBelow && LibraryScanner.cmp(version, r.atOrBelow) > 0) return false;
    return true;
  }

  private static rangeStr(r: VersionRange): string {
    const parts: string[] = [];
    if (r.atOrAbove) parts.push(`>=${r.atOrAbove}`);
    if (r.above) parts.push(`>${r.above}`);
    if (r.below) parts.push(`<${r.below}`);
    if (r.atOrBelow) parts.push(`<=${r.atOrBelow}`);
    return parts.join(' ');
  }

  // Numeric-segment version compare (good enough for retire below/atOrAbove ranges).
  private static cmp(a: string, b: string): number {
    const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
    const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
}
