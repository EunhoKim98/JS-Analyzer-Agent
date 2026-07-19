import { Finding, Verdict, SinkRecord, LibraryFinding } from '../types';

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
  assets: ReturnType<typeof import('./json').buildAssetsExport>;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildHtml(d: ReportData): string {
  const statusOf = (f: Finding): string => d.verdicts[f.id]?.status || 'needs_review';
  const groups: Record<string, Finding[]> = { 'confirmed-active': [], confirmed: [], needs_review: [], rejected: [] };
  for (const f of d.findings) (groups[statusOf(f)] ||= []).push(f);

  const confirmedCount = groups['confirmed'].length + groups['confirmed-active'].length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JS Analyzer Agent report — ${esc(d.target)}</title>
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
  <div class="meta">target: <code>${esc(d.target)}</code> · run: ${esc(d.runId)} · ${esc(d.timestamp)} ·
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

  ${librariesSection(d.libraries, d.librarySkipped)}
  ${section('Confirmed', [...groups['confirmed-active'], ...groups['confirmed']], d)}
  ${section('Needs review', groups['needs_review'], d)}
  ${section('Rejected', groups['rejected'], d)}
  ${unanalyzedSection(d.unanalyzed)}
  ${assetsSection(d)}
</main>
</body></html>`;
}

function section(title: string, findings: Finding[], d: ReportData): string {
  if (!findings.length) return '';
  return `<h2>${esc(title)} <span class="muted">(${findings.length})</span></h2>` +
    findings.map((f) => findingCard(f, d)).join('');
}

function findingCard(f: Finding, d: ReportData): string {
  const v = d.verdicts[f.id];
  const status = v?.status || 'needs_review';
  const poc = f.evidence.poc;
  return `<div class="finding">
    <div class="head">
      <span class="tag st-${esc(status)}">${esc(status)}</span>
      <span class="tag sev-${esc(f.class.includes('xss') ? 'high' : 'medium')}">${esc(f.class)}</span>
      <b>${esc(f.evidence.file)}:${esc(f.evidence.span[0])}</b>
      <span class="kv">verdict: ${esc(f.verdict)} · confidence: ${esc(f.confidence)}</span>
    </div>
    <div style="padding:10px 14px">
      <div class="kv">taint: <code>${esc(f.evidence.taint_path.join('  →  '))}</code></div>
      ${f.evidence.assumed_input ? `<div class="kv">input: <code>${esc(f.evidence.assumed_input)}</code></div>` : ''}
      ${f.reasoning ? `<div style="margin:6px 0">${esc(f.reasoning)}</div>` : ''}
      ${v ? `<div class="kv">judge: ${esc(v.judge_verdict)} · recheck: ${v.deterministic_recheck ? 'pass' : 'fail'} — ${esc(v.reason)}</div>` : ''}
      ${poc ? `<div class="kv">PoC (${esc(poc.type)}${poc.destructive ? ', DESTRUCTIVE — manual only' : ''}): <code>${esc(poc.payload)}</code></div>` : ''}
    </div>
  </div>`;
}

function unanalyzedSection(sinks: SinkRecord[]): string {
  if (!sinks.length) return '';
  return `<h2>Unanalyzed sinks <span class="muted">(${sinks.length}, static only — over budget)</span></h2>
  <table><tr><th>class</th><th>api</th><th>location</th><th>grade</th><th>source</th></tr>
  ${sinks.map((s) => `<tr><td>${esc(s.class)}</td><td><code>${esc(s.sink.api)}</code></td>
    <td>${esc(s.sink.file)}:${esc(s.sink.line)}</td><td>${esc(s.path_grade)}</td>
    <td>${esc(s.source.kind || '—')}</td></tr>`).join('')}
  </table>`;
}

function librariesSection(libs: LibraryFinding[], skipped: number): string {
  if (!libs.length) {
    return skipped ? `<p class="muted">${skipped} vendor/library sink(s) routed to the CVE path (no known library fingerprinted).</p>` : '';
  }
  const vuln = libs.filter((l) => l.vulnerabilities.length);
  const rows = [...libs]
    .sort((a, b) => b.vulnerabilities.length - a.vulnerabilities.length)
    .map((l) => {
      const cves = l.vulnerabilities.flatMap((v) => v.cve);
      const sev = worstSeverity(l.vulnerabilities);
      return `<tr>
        <td><code>${esc(l.component)}</code></td>
        <td>${esc(l.version)}</td>
        <td>${esc(l.file)}</td>
        <td>${l.vulnerabilities.length ? `<span class="tag sev-${esc(sev)}">${l.vulnerabilities.length} CVE</span>` : '<span class="muted">—</span>'}</td>
        <td>${cves.length ? cves.map((c) => esc(c)).join(', ') : '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join('');
  return `<h2>Libraries &amp; CVEs <span class="muted">(${libs.length} libraries, ${vuln.length} with known CVEs; ${skipped} vendor sinks routed here, not LLM-analyzed)</span></h2>
    <table><tr><th>library</th><th>version</th><th>file</th><th>severity</th><th>CVEs</th></tr>${rows}</table>`;
}

function worstSeverity(vulns: { severity: string }[]): string {
  for (const s of ['critical', 'high', 'medium', 'low']) {
    if (vulns.some((v) => v.severity === s)) return s;
  }
  return 'info';
}

function assetsSection(d: ReportData): string {
  const a = d.assets;
  const list = (title: string, items: string[]) =>
    items.length ? `<h2>${esc(title)} <span class="muted">(${items.length})</span></h2>
      <table>${items.map((x) => `<tr><td><code>${esc(x)}</code></td></tr>`).join('')}</table>` : '';
  const secrets = a.secrets.length
    ? `<h2>Secrets <span class="muted">(${a.secrets.length})</span></h2>
      <table><tr><th>kind</th><th>value</th><th>class</th><th>location</th></tr>
      ${a.secrets.map((s) => `<tr><td>${esc(s.kind)}</td><td><code>${esc(s.value)}</code></td>
        <td>${esc(s.classification)}</td><td>${esc(s.file)}:${esc(s.line)}</td></tr>`).join('')}</table>`
    : '';
  return list('API endpoints', a.apis) + list('Paths', a.paths) + list('Parameters', a.params) + secrets;
}
