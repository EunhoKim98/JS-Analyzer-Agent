import { RuleCard, AssetRecord } from '../types';

// Deterministic asset + secret extraction over source text (DESIGN.md §5).
export function extractAssets(code: string, file: string, rules: RuleCard[]): AssetRecord[] {
  const out: AssetRecord[] = [];
  const lines = code.split('\n');

  // ---- paths / URLs / API endpoints ----
  const urlRe = /https?:\/\/[^\s'"`)]+/g;
  const pathRe = /['"`](\/[A-Za-z0-9_\-./]{2,}(?:\?[^'"`]*)?)['"`]/g;

  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(line))) {
      pushUnique(out, { type: 'api', value: m[0], file, line: i + 1 });
      collectParams(m[0], file, i + 1, out);
    }
    pathRe.lastIndex = 0;
    while ((m = pathRe.exec(line))) {
      const val = m[1];
      pushUnique(out, { type: /^\/api|\/v\d|\/graphql/i.test(val) ? 'api' : 'path', value: val, file, line: i + 1 });
      collectParams(val, file, i + 1, out);
    }
  });

  // ---- secrets (regex rule cards) ----
  const secretCard = rules.find((r) => r.detector === 'regex');
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
            value: redact(m[0]),
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

function collectParams(url: string, file: string, line: number, out: AssetRecord[]): void {
  const q = url.indexOf('?');
  if (q === -1) return;
  const qs = url.slice(q + 1);
  for (const pair of qs.split('&')) {
    const key = pair.split('=')[0];
    if (key) pushUnique(out, { type: 'param', value: key, file, line });
  }
}

function pushUnique(out: AssetRecord[], rec: AssetRecord): void {
  if (!out.some((a) => a.type === rec.type && a.value === rec.value)) out.push(rec);
}

function redact(secret: string): string {
  if (secret.length <= 8) return secret;
  return secret.slice(0, 6) + '…' + secret.slice(-3);
}
