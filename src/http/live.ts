// 라이브 웹 UI(D8) — 코어가 서빙하는 자기완결 HTML 1장. 브라우저 EventSource로
// /jobs/:id/events(SSE)를 받아 finding을 실시간 렌더하고, verdict 도착 시 해당 행을 갱신한다.
// 토큰이 설정된 배포에서는 live URL의 ?token= 을 events URL로 그대로 전달한다.
export function buildLiveHtml(jobId: string): string {
  const id = jobId.replace(/[^a-zA-Z0-9-]/g, '');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JS Analyzer — live ${id}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0e0f16; color:#e8e9f1; font:14px/1.55 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif; }
  header { padding:16px 24px; background:#161722; border-bottom:1px solid #2a2c3f; }
  h1 { margin:0; font-size:16px; font-weight:640; }
  .meta { color:#a0a2bd; font-size:12px; margin-top:4px; font-family:ui-monospace,monospace; }
  .status { display:inline-block; margin-top:8px; font-size:12px; font-family:ui-monospace,monospace; color:#a48fff; }
  main { padding:16px 24px 60px; max-width:1100px; }
  .cards { display:flex; gap:10px; flex-wrap:wrap; margin:0 0 16px; }
  .card { background:#161722; border:1px solid #2a2c3f; border-radius:10px; padding:10px 16px; min-width:96px; }
  .card b { font-size:22px; display:block; }
  .card span { color:#a0a2bd; font-size:11px; }
  table { border-collapse:collapse; width:100%; font-size:12.5px; }
  th,td { border:1px solid #2a2c3f; padding:6px 9px; text-align:left; vertical-align:top; }
  th { color:#a0a2bd; font-weight:600; position:sticky; top:0; background:#161722; }
  code { color:#8ad0ff; font-family:ui-monospace,monospace; }
  .tag { font-size:10.5px; padding:2px 7px; border-radius:12px; font-weight:600; white-space:nowrap; }
  .st-pending { background:#2a2f3a; color:#a0a2bd; }
  .st-confirmed,.st-confirmed-active { background:#14351f; color:#7ee2a1; }
  .st-needs_review { background:#4a3a16; color:#ffd48a; }
  .st-rejected { background:#2a2f3a; color:#93a1b0; }
  .v-vulnerable { color:#f0736c; } .v-uncertain { color:#ffd48a; } .v-not_vulnerable { color:#93a1b0; }
  tr.pending { opacity:.7; }
</style></head>
<body>
<header>
  <h1>JS Analyzer — 라이브 결과</h1>
  <div class="meta">job <code>${id}</code></div>
  <div class="status" id="status">연결 중…</div>
</header>
<main>
  <div class="cards">
    <div class="card"><b id="c-total">0</b><span>findings</span></div>
    <div class="card"><b id="c-confirmed">0</b><span>confirmed</span></div>
    <div class="card"><b id="c-review">0</b><span>needs review</span></div>
    <div class="card"><b id="c-rejected">0</b><span>rejected</span></div>
  </div>
  <table>
    <thead><tr><th>class</th><th>location</th><th>verdict</th><th>conf</th><th>judge</th><th>reasoning</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</main>
<script>
(function(){
  var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var rows=document.getElementById('rows'), statusEl=document.getElementById('status');
  var seen={}, total=0, counts={confirmed:0,needs_review:0,rejected:0};
  function setStatus(t){ statusEl.textContent=t; }
  function addFinding(f){
    if(seen[f.id]) return;
    total++; document.getElementById('c-total').textContent=total;
    var tr=document.createElement('tr'); tr.id='f-'+f.id; tr.className='pending';
    var loc=esc(f.evidence.file)+':'+esc(f.evidence.span[0]);
    tr.innerHTML='<td>'+esc(f.class)+'</td><td><code>'+loc+'</code></td>'+
      '<td class="v-'+esc(f.verdict)+'">'+esc(f.verdict)+'</td>'+
      '<td>'+esc(f.confidence)+'</td>'+
      '<td><span class="tag st-pending" id="s-'+f.id+'">pending</span></td>'+
      '<td>'+esc(f.reasoning||'')+'</td>';
    rows.appendChild(tr); seen[f.id]=true;
  }
  function applyVerdict(v){
    var tr=document.getElementById('f-'+v.finding_id); if(tr) tr.className='';
    var s=document.getElementById('s-'+v.finding_id);
    if(s){ s.textContent=v.status; s.className='tag st-'+v.status; }
    if(counts[v.status]!=null){ counts[v.status]++; }
    else if(v.status==='confirmed-active'){ counts.confirmed++; }
    document.getElementById('c-confirmed').textContent=counts.confirmed;
    document.getElementById('c-review').textContent=counts.needs_review;
    document.getElementById('c-rejected').textContent=counts.rejected;
  }
  var es=new EventSource('/jobs/${id}/events'+location.search);
  es.onmessage=function(ev){
    var e; try{ e=JSON.parse(ev.data);}catch(_){ return; }
    if(e.type==='stage'){ setStatus('분석 중 — '+e.name); }
    else if(e.type==='finding'){ addFinding(e.finding); }
    else if(e.type==='verdict'){ applyVerdict(e); }
    else if(e.type==='done'){ setStatus('완료 — '+total+' findings'); es.close(); }
    else if(e.type==='error'){ setStatus('에러: '+esc(e.message)); es.close(); }
  };
  es.onerror=function(){ setStatus('연결 종료(또는 서버 대기).'); };
})();
</script>
</body></html>`;
}
