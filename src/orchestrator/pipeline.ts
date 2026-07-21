import { ConfigLoader } from '../config';
import { RuleRepository } from '../static/rules';
import { StaticAnalyzer } from '../static';
import { Unbundler } from '../static/unbundle';
import { SourceAcquirer } from '../ingest/acquire';
import { AuthResolver } from '../agents/client';
import { createLlmProvider } from '../agents/providers/factory';
import { HtmlReporter } from '../report/html';
import { AssetsExporter } from '../report/json';
import { CodeSlicer } from '../util/slice';
import { rulesDir, dataDir } from '../util/paths';
import { RunContext, RunOptions, RunResult } from './context';
import {
  PipelineStage,
  AcquireStage,
  UnbundleStage,
  StaticStage,
  RouteStage,
  AnalyzeStage,
  JudgeStage,
  ReportStage,
} from './stages';

export { RunOptions, RunResult } from './context';

// 파이프라인 — 순서가 정해진 스테이지들을 하나의 공유 컨텍스트 위에서 차례로 실행한다
// (Composite/Chain-of-Responsibility). 조합만 담당하고 각 단계의 세부 로직은 모른다(SRP).
export class Pipeline {
  constructor(private readonly stages: PipelineStage[]) {}

  async run(ctx: RunContext): Promise<RunResult> {
    for (const stage of this.stages) {
      await stage.run(ctx);
    }
    return { runId: ctx.runId, dir: ctx.store.dir, reportPath: ctx.reportPath, meta: ctx.meta! };
  }
}

// 합성 루트(Composition Root) — 모든 협력자를 한 곳에서 생성·주입해 파이프라인을 조립한다.
// 의존성 생성을 여기로 모아 각 클래스는 "무엇을 하는지"에만 집중한다(DIP).
export function runPipeline(opts: RunOptions): Promise<RunResult> {
  const config = new ConfigLoader().load(opts.configPath);
  if (opts.maxSinks != null) config.maxSinks = opts.maxSinks;
  if (opts.provider) config.provider = opts.provider;

  const rules = RuleRepository.load(rulesDir());
  const auth = new AuthResolver();
  const llm = createLlmProvider(config.provider, auth);
  const slicer = new CodeSlicer();

  const pipeline = new Pipeline([
    new AcquireStage(new SourceAcquirer()),
    new UnbundleStage(new Unbundler()),
    new StaticStage(new StaticAnalyzer(rules, dataDir())),
    new RouteStage(auth),
    new AnalyzeStage(llm, rules, slicer),
    new JudgeStage(llm, slicer),
    new ReportStage(auth, new HtmlReporter(), new AssetsExporter()),
  ]);

  return pipeline.run(new RunContext(opts, config));
}
