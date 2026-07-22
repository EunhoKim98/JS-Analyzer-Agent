import { Finding, Verdict } from '../types';
import { RunContext, RunMeta } from './context';
import { RunStore, makeRunId } from './store';
import { SourceAcquirer } from '../ingest/acquire';
import { Unbundler } from '../static/unbundle';
import { StaticAnalyzer } from '../static';
import { RuleRepository } from '../static/rules';
import { AuthResolver } from '../agents/client';
import { LlmProvider } from '../agents/provider';
import { AnalyzeAgent } from '../agents/analyze';
import { JudgeAgent } from '../agents/judge';
import { HtmlReporter, ReportData } from '../report/html';
import { AssetsExporter } from '../report/json';
import { CodeSlicer } from '../util/slice';
import { mapLimit } from '../util/concurrency';

// 파이프라인 스테이지 공통 계약 — 컨텍스트를 받아 자기 몫의 상태를 채운다.
// Pipeline은 이 인터페이스에만 의존하므로 스테이지를 추가·재배열해도
// 오케스트레이터 코드는 그대로다(OCP; Chain-of-Responsibility 형태의 조합).
export interface PipelineStage {
  readonly name: string;
  run(ctx: RunContext): Promise<void>;
}

// [0] 취득 — 대상에서 원시 JS를 모으고, 콘텐츠 해시로 run id·저장소를 만든다.
export class AcquireStage implements PipelineStage {
  readonly name = 'acquire';
  constructor(private readonly acquirer: SourceAcquirer) {}

  async run(ctx: RunContext): Promise<void> {
    const res = await this.acquirer.acquire(ctx.opts.target, { seedFiles: ctx.opts.seedFiles });
    ctx.raw = res.files;
    ctx.acquisition = res.acquisition;
    ctx.targetDir = res.targetDir;

    ctx.contentHash = (ctx.raw.map((r) => r.contentHash).join('') || 'empty').slice(0, 16);
    ctx.runId = makeRunId(ctx.contentHash);
    ctx.store = new RunStore(ctx.opts.baseDir || process.cwd(), ctx.runId);
  }
}

// [1] 언번들 — 취득한 각 파일을 소스맵 복원 또는 beautify 로 정규화한다.
export class UnbundleStage implements PipelineStage {
  readonly name = 'unbundle';
  constructor(private readonly unbundler: Unbundler) {}

  async run(ctx: RunContext): Promise<void> {
    for (const r of ctx.raw) {
      const parts = await this.unbundler.unbundle(r, ctx.targetDir);
      for (const p of parts) {
        ctx.store.writeReconstructed(p.file, p.code);
        ctx.files.push(p);
      }
    }
  }
}

// [2] 정적 프리패스 — 싱크·자산·라이브러리를 결정론적으로 찾아 랭킹한다.
export class StaticStage implements PipelineStage {
  readonly name = 'static';
  constructor(private readonly analyzer: StaticAnalyzer) {}

  async run(ctx: RunContext): Promise<void> {
    const { sinks, assets, libraries } = this.analyzer.analyze(ctx.files);
    ctx.sinks = sinks;
    ctx.assets = assets;
    ctx.libraries = libraries;
    ctx.store.writeJson('sinks.json', sinks);
    ctx.store.writeJson('asset_manifest.json', assets);
    ctx.store.writeJson('libraries.json', libraries);
  }
}

// [3] 라우팅 — 벤더/라이브러리 싱크는 CVE 경로로 보내고, 애플리케이션 싱크만
// LLM 예산(maxSinks) 안에서 분석 대상으로 고른다(DESIGN.md §5/§15).
export class RouteStage implements PipelineStage {
  readonly name = 'route';
  constructor(private readonly auth: AuthResolver) {}

  async run(ctx: RunContext): Promise<void> {
    const { config } = ctx;
    // CLI providers (claude-cli/codex) use their own local login, not AuthResolver;
    // only the SDK provider needs an API key/OAuth token resolved here.
    const providerReady = config.provider !== 'sdk' || this.auth.hasAuth();
    ctx.useLlm = !ctx.opts.noLlm && providerReady;

    const libFiles = new Set(
      ctx.files.filter((f) => StaticAnalyzer.isLibraryFile(f.file, ctx.libraries)).map((f) => f.file),
    );
    // Vendor files go the CVE route — EXCEPT vendor sinks with an identified source
    // (e.g. a postMessage handler with no origin check), which are real leads
    // regardless of living in library code, so keep those for LLM analysis.
    ctx.appSinks = config.analyzeVendorSinks
      ? ctx.sinks
      : ctx.sinks.filter((s) => !libFiles.has(s.sink.file) || s.source.found);
    ctx.librarySkipped = ctx.sinks.length - ctx.appSinks.length;
    ctx.cveCount = ctx.libraries.reduce((n, l) => n + l.vulnerabilities.length, 0);

    // maxSinks <= 0 means analyze ALL app sinks (no cap); >0 caps to top-K.
    const cap = config.maxSinks > 0 ? config.maxSinks : ctx.appSinks.length;
    ctx.analyzeSet = ctx.appSinks.slice(0, cap);
    ctx.unanalyzed = ctx.appSinks.slice(cap);

    if (libFiles.size) {
      console.error(
        `[route] ${libFiles.size} library/vendor file(s) → CVE path (${ctx.librarySkipped} sinks skipped); ` +
          `${ctx.libraries.length} libraries fingerprinted, ${ctx.cveCount} known CVEs`,
      );
    }
    if (ctx.useLlm && ctx.analyzeSet.length) {
      console.error(
        `[analyze] ${ctx.analyzeSet.length} app sink(s) → LLM (${config.models.analyze}); ` +
          `this consumes quota and may take a while at concurrency ${config.concurrency}`,
      );
    }
  }
}

// [5] 분석 — 후보 싱크마다 OODA 한 라운드(Sonnet). LLM 미사용 시 정적 폴백.
export class AnalyzeStage implements PipelineStage {
  readonly name = 'analyze';
  constructor(
    private readonly llm: LlmProvider,
    private readonly rules: RuleRepository,
    private readonly slicer: CodeSlicer,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    if (ctx.useLlm) {
      const agent = new AnalyzeAgent(this.llm, ctx.config, ctx.store);
      const codeByFile = ctx.codeByFile();
      const findings: Finding[] = [];
      await mapLimit(ctx.analyzeSet, ctx.config.concurrency, async (sink) => {
        const slice = this.slicer.around(codeByFile.get(sink.sink.file) || '', sink.sink.line);
        const finding = await agent.run({ sink, slice, card: this.rules.byClass(sink.class) });
        findings.push(finding);
        ctx.emit({ type: 'finding', finding }); // stream as each sink completes (D8)
      });
      ctx.findings = findings;
    } else {
      // static-only mode: emit uncertain findings for human review
      const reason = ctx.opts.noLlm ? '--no-llm' : 'no credentials';
      ctx.findings = ctx.analyzeSet.map((sink) => {
        const finding = AnalyzeAgent.staticFallback(sink, reason);
        ctx.emit({ type: 'finding', finding });
        return finding;
      });
    }
    ctx.store.appendJsonl('findings.jsonl', ctx.findings);
  }
}

// [7] 판정 — vulnerable/uncertain 소견을 Opus 판정 + 결정론적 재확인으로 검증한다.
export class JudgeStage implements PipelineStage {
  readonly name = 'judge';
  constructor(
    private readonly llm: LlmProvider,
    private readonly slicer: CodeSlicer,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    if (!ctx.useLlm) return; // static-only mode produces no verdicts

    const agent = new JudgeAgent(this.llm, ctx.config, ctx.store);
    const codeByFile = ctx.codeByFile();
    const verdicts: Record<string, Verdict> = {};
    const toJudge = ctx.findings.filter((f) => f.verdict !== 'not_vulnerable');
    await mapLimit(toJudge, ctx.config.concurrency, async (f) => {
      const code = codeByFile.get(f.evidence.file) || '';
      const verdict = await agent.run({
        finding: f,
        slice: this.slicer.around(code, f.evidence.span[0]),
        fileCode: code,
      });
      verdicts[f.id] = verdict;
      ctx.emit({ type: 'verdict', finding_id: f.id, status: verdict.status, verdict }); // D8
    });
    ctx.verdicts = verdicts;
    ctx.store.writeJson('verdicts.json', Object.values(verdicts));
  }
}

// [8] 리포트 — assets_export.json / report.html / meta.json 을 생성한다.
export class ReportStage implements PipelineStage {
  readonly name = 'report';
  constructor(
    private readonly auth: AuthResolver,
    private readonly reporter: HtmlReporter,
    private readonly exporter: AssetsExporter,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    ctx.timestamp = new Date().toISOString();
    const assetsExport = this.exporter.export(ctx.assets);
    ctx.assetsExport = assetsExport;
    ctx.store.writeJson('assets_export.json', assetsExport);

    const reportData: ReportData = {
      target: ctx.opts.target,
      runId: ctx.runId,
      timestamp: ctx.timestamp,
      llmUsed: ctx.useLlm,
      findings: ctx.findings,
      verdicts: ctx.verdicts,
      unanalyzed: ctx.unanalyzed,
      libraries: ctx.libraries,
      librarySkipped: ctx.librarySkipped,
      assets: assetsExport,
    };
    ctx.store.writeText('report.html', this.reporter.build(reportData));

    const confirmed = Object.values(ctx.verdicts).filter((v) => v.status.startsWith('confirmed')).length;
    const meta: RunMeta = {
      target: ctx.opts.target,
      runId: ctx.runId,
      contentHash: ctx.contentHash,
      timestamp: ctx.timestamp,
      acquisition: ctx.acquisition,
      files: ctx.files.map((f) => ({ file: f.file, origin: f.origin })),
      llmUsed: ctx.useLlm,
      auth: ctx.config.provider === 'sdk' ? this.auth.describe() : `${ctx.config.provider} (local CLI)`,
      config: { maxSinks: ctx.config.maxSinks, models: ctx.config.models },
      counts: {
        sinks: ctx.sinks.length,
        appSinks: ctx.appSinks.length,
        librarySkipped: ctx.librarySkipped,
        analyzed: ctx.analyzeSet.length,
        findings: ctx.findings.length,
        confirmed,
        libraries: ctx.libraries.length,
        cves: ctx.cveCount,
        assets: ctx.assets.length,
      },
    };
    ctx.store.writeJson('meta.json', meta);
    ctx.reportPath = ctx.store.path('report.html');
    ctx.meta = meta;
  }
}
