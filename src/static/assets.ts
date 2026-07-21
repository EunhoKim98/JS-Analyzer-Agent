import { RuleCard, AssetRecord } from '../types';

// 자산 추출기 — 소스 텍스트에서 경로·URL·엔드포인트·파라미터·시크릿을 뽑아낸다
// (DESIGN.md §5). 결정론적이며 LLM을 쓰지 않는다.
export class AssetExtractor {
  private static readonly URL_RE = /https?:\/\/[^\s'"`)]+/g;
  private static readonly PATH_RE = /['"`](\/[A-Za-z0-9_\-./]{2,}(?:\?[^'"`]*)?)['"`]/g;

  constructor(private readonly rules: RuleCard[]) {}

  extract(code: string, file: string): AssetRecord[] {
    const out: AssetRecord[] = [];
    const lines = code.split('\n');

    // ---- paths / URLs / API endpoints ----
    lines.forEach((line, i) => {
      let m: RegExpExecArray | null;
      AssetExtractor.URL_RE.lastIndex = 0;
      while ((m = AssetExtractor.URL_RE.exec(line))) {
        AssetExtractor.pushUnique(out, { type: 'api', value: m[0], file, line: i + 1 });
        AssetExtractor.collectParams(m[0], file, i + 1, out);
      }
      AssetExtractor.PATH_RE.lastIndex = 0;
      while ((m = AssetExtractor.PATH_RE.exec(line))) {
        const val = m[1];
        AssetExtractor.pushUnique(out, {
          type: /^\/api|\/v\d|\/graphql/i.test(val) ? 'api' : 'path',
          value: val,
          file,
          line: i + 1,
        });
        AssetExtractor.collectParams(val, file, i + 1, out);
      }
    });

    // ---- secrets (regex rule cards) ----
    const secretCard = this.rules.find((r) => r.detector === 'regex');
    if (secretCard?.patterns) {
      for (const pat of secretCard.patterns) {
        let re: RegExp;
        try {
          re = new RegExp(pat.regex, 'g');
        } catch {
          continue;
        }
        lines.forEach((line, i) => {
          let m: RegExpExecArray | null;
          re.lastIndex = 0;
          while ((m = re.exec(line))) {
            out.push({
              type: 'secret',
              value: AssetExtractor.redact(m[0]),
              file,
              line: i + 1,
              secretKind: pat.name,
              classification: pat.classification,
            });
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        });
      }
    }

    return out;
  }

  private static collectParams(url: string, file: string, line: number, out: AssetRecord[]): void {
    const q = url.indexOf('?');
    if (q === -1) return;
    const qs = url.slice(q + 1);
    for (const pair of qs.split('&')) {
      const key = pair.split('=')[0];
      if (key) AssetExtractor.pushUnique(out, { type: 'param', value: key, file, line });
    }
  }

  private static pushUnique(out: AssetRecord[], rec: AssetRecord): void {
    if (!out.some((a) => a.type === rec.type && a.value === rec.value)) out.push(rec);
  }

  private static redact(secret: string): string {
    if (secret.length <= 8) return secret;
    return secret.slice(0, 6) + '…' + secret.slice(-3);
  }
}
