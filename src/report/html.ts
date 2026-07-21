import { Finding, Verdict, SinkRecord, LibraryFinding } from '../types';
import { AssetsExport } from './json';

export interface ReportData {
  target: string;
  runId: string;
  timestamp: string;
  llmUsed: boolean;
  findings: Finding[];
  verdicts: Record<string, Verdict>;
  unanalyzed: SinkRecord[];
  libraries: LibraryFinding[];
  librarySkipped: number;
  assets: AssetsExport;
}

// HTML 리포터(Stage [8]) — 파이프라인 결과를 사람이 읽는 단일 HTML 문서로 렌더링한다.
// 각 섹션 렌더링을 비공개 메서드로 나눠 응집도를 높였고, HTML 이스케이프 같은 순수
// 유틸은 정적 메서드로 둔다. JSON 익스포트(AssetsExporter)와 표현 책임을 분리한다(SRP).
export class HtmlReporter {
  build(d: ReportData): string {
    const groups: Record<string, Finding[]> = {
      'confirmed-active': [], confirmed: [], needs_review: [], rejected: [],
    };
    for (const f of d.findings) (groups[this.statusOf(f, d)] ||= []).push(f);

    const confirmedCount = groups['confirmed'].length + groups['confirmed-active'].length;

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JS Analyzer Agent report — ${HtmlReporter.esc(d.target)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background:#0f1115; color:#e6e6e6; }
  header { padding: 20px 28px; background:#161a22; border-bottom:1px solid #262b36; }
  h1 { margin:0 0 4px; font-size:19px; } h2 { font-size:16px; margin:28px 0 10px; }
  .meta { color:#93a1b0; font-size:12px; }
  main { padding: 8px 28px 60px; max-width:1100px; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0; }
  .card { background:#161a22; border:1px solid #262b36; border-radius:8px; padding:12px 16px; min-width:120px; }
  .card b { font-size:22px; display:block; }
  .finding { border:1px solid #262b36; border-radius:8px; margin:10px 0; overflow:hidden; }
  .finding > .head { padding:10px 14px; display:flex; gap:10px; align-items:center; background:#161a22; flex-wrap:wrap; }
  .finding pre { margin:0; padding:12px 14px; background:#0b0d11; overflow-x:auto; font:12px/1.5 ui-monospace, monospace; }
  .tag { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; }
  .sev-critical,.sev-high { background:#4a1620; color:#ff9db0; }
  .sev-medium { background:#4a3a16; color:#ffd48a; }
  .sev-low,.sev-info { background:#1d3a4a; color:#8ad0ff; }
  .st-confirmed,.st-confirmed-active { background:#14351f; color:#7ee2a1; }
  .st-needs_review { background:#4a3a16; color:#ffd48a; }
  .st-rejected { background:#2a2f3a; color:#93a1b0; }
  .kv { color:#93a1b0; font-size:12px; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  td,th { border:1px solid #262b36; padding:6px 8px; text-align:left; vertical-align:top; }
  code { color:#8ad0ff; }
  .muted { color:#93a1b0; }
</style></head>
<body>
<header>
  <h1>JS Analyzer Agent report</h1>
  <div class="meta">target: <code>${HtmlReporter.esc(d.target)}</code> · run: ${HtmlReporter.esc(d.runId)} · ${HtmlReporter.esc(d.timestamp)} ·
  mode: ${d.llmUsed ? 'static + LLM' : 'static only (no credentials / --no-llm)'}</div>
</header>
<main>
  <div class="cards">
    <div class="card"><b>${confirmedCount}</b>confirmed</div>
    <div class="card"><b>${groups['needs_review'].length}</b>needs review</div>
    <div class="card"><b>${groups['rejected'].length}</b>rejected</div>
    <div class="card"><b>${d.libraries.reduce((n, l) => n + l.vulnerabilities.length, 0)}</b>library CVEs</div>
    <div class="card"><b>${d.assets.counts.secrets}</b>secrets</div>
  </div>

  ${this.librariesSection(d.libraries, d.librarySkipped)}
  ${this.section('Confirmed', [...groups['confirmed-active'], ...groups['confirmed']], d)}
  ${this.section('Needs review', groups['needs_review'], d)}
  ${this.section('Rejected', groups['rejected'], d)}
  ${this.unanalyzedSection(d.unanalyzed)}
  ${this.assetsSection(d)}
</main>
</body></html>`;
  }

  private statusOf(f: Finding, d: ReportData): string {
    return d.verdicts[f.id]?.status || 'needs_review';
  }

  private section(title: string, findings: Finding[], d: ReportData): string {
    if (!findings.length) return '';
    return `<h2>${HtmlReporter.esc(title)} <span class="muted">(${findings.length})</span></h2>` +
      findings.map((f) => this.findingCard(f, d)).join('');
  }

  private findingCard(f: Finding, d: ReportData): string {
    const v = d.verdicts[f.id];
    const status = v?.status || 'needs_review';
    const poc = f.evidence.poc;
    return `<div class="finding">
    <div class="head">
      <span class="tag st-${HtmlReporter.esc(status)}">${HtmlReporter.esc(status)}</span>
      <span class="tag sev-${HtmlReporter.esc(f.class.includes('xss') ? 'high' : 'medium')}">${HtmlReporter.esc(f.class)}</span>
      <b>${HtmlReporter.esc(f.evidence.file)}:${HtmlReporter.esc(f.evidence.span[0])}</b>
      <span class="kv">verdict: ${HtmlReporter.esc(f.verdict)} · confidence: ${HtmlReporter.esc(f.confidence)}</span>
    </div>
    <div style="padding:10px 14px">
      <div class="kv">taint: <code>${HtmlReporter.esc(f.evidence.taint_path.join('  →  '))}</code></div>
      ${f.evidence.assumed_input ? `<div class="kv">input: <code>${HtmlReporter.esc(f.evidence.assumed_input)}</code></div>` : ''}
      ${f.reasoning ? `<div style="margin:6px 0">${HtmlReporter.esc(f.reasoning)}</div>` : ''}
      ${v ? `<div class="kv">judge: ${HtmlReporter.esc(v.judge_verdict)} · recheck: ${v.deterministic_recheck ? 'pass' : 'fail'} — ${HtmlReporter.esc(v.reason)}</div>` : ''}
      ${poc ? `<div class="kv">PoC (${HtmlReporter.esc(poc.type)}${poc.destructive ? ', DESTRUCTIVE — manual only' : ''}): <code>${HtmlReporter.esc(poc.payload)}</code></div>` : ''}
    </div>
  </div>`;
  }

  private unanalyzedSection(sinks: SinkRecord[]): string {
    if (!sinks.length) return '';
    return `<h2>Unanalyzed sinks <span class="muted">(${sinks.length}, static only — over budget)</span></h2>
  <table><tr><th>class</th><th>api</th><th>location</th><th>grade</th><th>source</th></tr>
  ${sinks.map((s) => `<tr><td>${HtmlReporter.esc(s.class)}</td><td><code>${HtmlReporter.esc(s.sink.api)}</code></td>
    <td>${HtmlReporter.esc(s.sink.file)}:${HtmlReporter.esc(s.sink.line)}</td><td>${HtmlReporter.esc(s.path_grade)}</td>
    <td>${HtmlReporter.esc(s.source.kind || '—')}</td></tr>`).join('')}
  </table>`;
  }

  private librariesSection(libs: LibraryFinding[], skipped: number): string {
    if (!libs.length) {
      return skipped ? `<p class="muted">${skipped} vendor/library sink(s) routed to the CVE path (no known library fingerprinted).</p>` : '';
    }
    const vuln = libs.filter((l) => l.vulnerabilities.length);
    const rows = [...libs]
      .sort((a, b) => b.vulnerabilities.length - a.vulnerabilities.length)
      .map((l) => {
        const cves = l.vulnerabilities.flatMap((v) => v.cve);
        const sev = HtmlReporter.worstSeverity(l.vulnerabilities);
        return `<tr>
        <td><code>${HtmlReporter.esc(l.component)}</code></td>
        <td>${HtmlReporter.esc(l.version)}</td>
        <td>${HtmlReporter.esc(l.file)}</td>
        <td>${l.vulnerabilities.length ? `<span class="tag sev-${HtmlReporter.esc(sev)}">${l.vulnerabilities.length} CVE</span>` : '<span class="muted">—</span>'}</td>
        <td>${cves.length ? cves.map((c) => HtmlReporter.esc(c)).join(', ') : '<span class="muted">—</span>'}</td>
      </tr>`;
      })
      .join('');
    return `<h2>Libraries &amp; CVEs <span class="muted">(${libs.length} libraries, ${vuln.length} with known CVEs; ${skipped} vendor sinks routed here, not LLM-analyzed)</span></h2>
    <table><tr><th>library</th><th>version</th><th>file</th><th>severity</th><th>CVEs</th></tr>${rows}</table>`;
  }

  private assetsSection(d: ReportData): string {
    const a = d.assets;
    const list = (title: string, items: string[]) =>
      items.length ? `<h2>${HtmlReporter.esc(title)} <span class="muted">(${items.length})</span></h2>
      <table>${items.map((x) => `<tr><td><code>${HtmlReporter.esc(x)}</code></td></tr>`).join('')}</table>` : '';
    const secrets = a.secrets.length
      ? `<h2>Secrets <span class="muted">(${a.secrets.length})</span></h2>
      <table><tr><th>kind</th><th>value</th><th>class</th><th>location</th></tr>
      ${a.secrets.map((s) => `<tr><td>${HtmlReporter.esc(s.kind)}</td><td><code>${HtmlReporter.esc(s.value)}</code></td>
        <td>${HtmlReporter.esc(s.classification)}</td><td>${HtmlReporter.esc(s.file)}:${HtmlReporter.esc(s.line)}</td></tr>`).join('')}</table>`
      : '';
    return list('API endpoints', a.apis) + list('Paths', a.paths) + list('Parameters', a.params) + secrets;
  }

  private static esc(s: unknown): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private static worstSeverity(vulns: { severity: string }[]): string {
    for (const s of ['critical', 'high', 'medium', 'low']) {
      if (vulns.some((v) => v.severity === s)) return s;
    }
    return 'info';
  }
}
