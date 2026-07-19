import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config';
import { ingest } from '../ingest';
import { discoverJs } from '../ingest/browser';
import { unbundle } from '../static/unbundle';
import { runStaticPrepass, loadRules, isLibraryFile } from '../static';
import { RunStore, makeRunId } from './store';
import { hasAuth, describeAuth } from '../agents/client';
import { analyzeSink, staticFallback } from '../agents/analyze';
import { judgeFinding } from '../agents/judge';
import { buildAssetsExport } from '../report/json';
import { buildHtml, ReportData } from '../report/html';
import { IngestedFile, Finding, Verdict } from '../types';

export interface RunOptions {
  target: string;
  configPath?: string;
  noLlm?: boolean;
  maxSinks?: number;
  baseDir?: string;
  browser?: boolean; // force Playwright page discovery
  noBrowser?: boolean; // force raw fetch even for a page URL
  scopeHosts?: string[]; // extra in-scope hosts for discovery
  allHosts?: boolean; // include third-party JS in discovery
}

export async function runPipeline(opts: RunOptions) {
  const config = loadConfig(opts.configPath);
  if (opts.maxSinks != null) config.maxSinks = opts.maxSinks;
  const rules = loadRules();
  const baseDir = opts.baseDir || process.cwd();

  // [0] acquire JS (DESIGN.md §4.11): page URL → Playwright discovery, else direct
  const isUrl = /^(https?|file):/i.test(opts.target);
  const isJsUrl = /\.m?js(\?|#|$)/i.test(opts.target);
  const useBrowser = !opts.noBrowser && (!!opts.browser || (isUrl && !isJsUrl));
  const raw =
    isUrl && useBrowser
      ? await discoverJs(opts.target, { scopeHosts: opts.scopeHosts, allHosts: opts.allHosts })
      : await ingest(opts.target);
  if (isUrl && useBrowser && !raw.length) console.error('[discover] no in-scope JS found on the page');
  const combinedHash = (raw.map((r) => r.contentHash).join('') || 'empty').slice(0, 16);
  const runId = makeRunId(combinedHash);
  const store = new RunStore(baseDir, runId);

  // [1] unbundle each acquired file
  const targetDir = isUrl
    ? undefined
    : fs.statSync(opts.target).isDirectory()
      ? opts.target
      : path.dirname(opts.target);
  const files: IngestedFile[] = [];
  for (const r of raw) {
    const parts = await unbundle(r, targetDir);
    for (const p of parts) {
      store.writeReconstructed(p.file, p.code);
      files.push(p);
    }
  }

  // [2] deterministic static pre-pass (+ library fingerprint / CVE match)
  const { sinks, assets, libraries } = runStaticPrepass(files, rules, path.resolve(__dirname, '../../data'));
  store.writeJson('sinks.json', sinks);
  store.writeJson('asset_manifest.json', assets);
  store.writeJson('libraries.json', libraries);

  const codeByFile = new Map(files.map((f) => [f.file, f.code]));
  const useLlm = !opts.noLlm && hasAuth();

  // Routing (DESIGN.md §5/§15): library/vendor files go the CVE route, not
  // per-sink LLM. Only application code sinks are analyzed by the LLM.
  const libFiles = new Set(files.filter((f) => isLibraryFile(f.file, libraries)).map((f) => f.file));
  // Vendor files go the CVE route — EXCEPT vendor sinks with an identified source
  // (e.g. a postMessage handler with no origin check), which are real leads
  // regardless of living in library code, so keep those for LLM analysis.
  const appSinks = config.analyzeVendorSinks
    ? sinks
    : sinks.filter((s) => !libFiles.has(s.sink.file) || s.source.found);
  const librarySkipped = sinks.length - appSinks.length;
  const cveCount = libraries.reduce((n, l) => n + l.vulnerabilities.length, 0);

  // maxSinks <= 0 means analyze ALL app sinks (no cap); >0 caps to top-K.
  const cap = config.maxSinks > 0 ? config.maxSinks : appSinks.length;
  const analyzeSet = appSinks.slice(0, cap);
  const unanalyzed = appSinks.slice(cap);
  if (libFiles.size) {
    console.error(
      `[route] ${libFiles.size} library/vendor file(s) → CVE path (${librarySkipped} sinks skipped); ` +
        `${libraries.length} libraries fingerprinted, ${cveCount} known CVEs`,
    );
  }
  if (useLlm && analyzeSet.length) {
    console.error(
      `[analyze] ${analyzeSet.length} app sink(s) → LLM (${config.models.analyze}); ` +
        `this consumes quota and may take a while at concurrency ${config.concurrency}`,
    );
  }

  const findings: Finding[] = [];
  const verdicts: Record<string, Verdict> = {};

  if (useLlm) {
    const cardByClass = new Map(rules.map((r) => [r.class, r]));

    // [5] analyze (Sonnet, sink-parallel)
    await mapLimit(analyzeSet, config.concurrency, async (sink) => {
      const slice = sliceFor(codeByFile.get(sink.sink.file) || '', sink.sink.line);
      findings.push(await analyzeSink(sink, slice, cardByClass.get(sink.class), config, store));
    });
    store.appendJsonl('findings.jsonl', findings);

    // [7] judge (Opus) for vulnerable/uncertain findings
    const toJudge = findings.filter((f) => f.verdict !== 'not_vulnerable');
    await mapLimit(toJudge, config.concurrency, async (f) => {
      const code = codeByFile.get(f.evidence.file) || '';
      verdicts[f.id] = await judgeFinding(f, sliceFor(code, f.evidence.span[0]), code, config, store);
    });
    store.writeJson('verdicts.json', Object.values(verdicts));
  } else {
    // static-only mode: emit uncertain findings for human review
    for (const sink of analyzeSet) {
      findings.push(staticFallback(sink, opts.noLlm ? '--no-llm' : 'no credentials'));
    }
    store.appendJsonl('findings.jsonl', findings);
  }

  // [8] report
  const assetsExport = buildAssetsExport(assets);
  store.writeJson('assets_export.json', assetsExport);
  const reportData: ReportData = {
    target: opts.target,
    runId,
    timestamp: new Date().toISOString(),
    llmUsed: useLlm,
    findings,
    verdicts,
    unanalyzed,
    libraries,
    librarySkipped,
    assets: assetsExport,
  };
  store.writeText('report.html', buildHtml(reportData));

  const confirmed = Object.values(verdicts).filter((v) => v.status.startsWith('confirmed')).length;
  const meta = {
    target: opts.target,
    runId,
    contentHash: combinedHash,
    timestamp: reportData.timestamp,
    acquisition: isUrl && useBrowser ? 'browser (playwright)' : 'direct',
    files: files.map((f) => ({ file: f.file, origin: f.origin })),
    llmUsed: useLlm,
    auth: describeAuth(),
    config: { maxSinks: config.maxSinks, models: config.models },
    counts: {
      sinks: sinks.length,
      appSinks: appSinks.length,
      librarySkipped,
      analyzed: analyzeSet.length,
      findings: findings.length,
      confirmed,
      libraries: libraries.length,
      cves: cveCount,
      assets: assets.length,
    },
  };
  store.writeJson('meta.json', meta);

  return { runId, dir: store.dir, reportPath: store.path('report.html'), meta };
}

// Build a small code slice around the sink. Minified files can have a single
// multi-MB line, so cap both per-line and total length or the prompt explodes
// (real bug: a ±6-line slice reached 1.6M tokens on chzzk's bundles).
function sliceFor(code: string, line: number, ctx = 6, maxChars = 8000, maxLine = 2000): string {
  const lines = code.split('\n');
  const start = Math.max(0, line - 1 - ctx);
  const end = Math.min(lines.length, line + ctx);
  const numbered = lines.slice(start, end).map((l, i) => {
    const capped = l.length > maxLine ? l.slice(0, maxLine) + ' /*…line truncated…*/' : l;
    return `${start + i + 1}: ${capped}`;
  });
  const slice = numbered.join('\n');
  return slice.length > maxChars ? slice.slice(0, maxChars) + '\n/*…slice truncated…*/' : slice;
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
