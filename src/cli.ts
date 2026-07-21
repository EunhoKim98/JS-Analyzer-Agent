#!/usr/bin/env node
import { runPipeline } from './orchestrator/pipeline';
import { RunOptions, RunResult } from './orchestrator/context';
import { startCoreServer } from './http';

// 인자 파서 — argv 배열에서 플래그·값을 꺼내는 저수준 파싱을 캡슐화한다(SRP).
// Cli는 "무엇을 파싱하는지"만 알고, "어떻게 꺼내는지"는 이 클래스가 담당한다.
class ArgParser {
  constructor(private readonly argv: string[]) {}

  has(name: string): boolean {
    return this.argv.includes(name);
  }

  flag(name: string): string | undefined {
    const i = this.argv.indexOf(name);
    return i >= 0 && this.argv[i + 1] ? this.argv[i + 1] : undefined;
  }

  numFlag(name: string): number | undefined {
    const v = this.flag(name);
    return v != null ? Number(v) : undefined;
  }

  at(index: number): string | undefined {
    return this.argv[index];
  }

  list(name: string): string[] | undefined {
    const v = this.flag(name);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  }
}

// CLI 애플리케이션 — 인자 해석, 사용법 출력, 파이프라인 실행/결과 표시를 담당한다.
export class Cli {
  constructor(private readonly argv: string[]) {}

  async run(): Promise<void> {
    const args = new ArgParser(this.argv);
    const cmd = args.at(0);
    if (args.has('--help') || (cmd !== 'analyze' && cmd !== 'serve')) {
      Cli.usage();
      process.exit(args.has('--help') ? 0 : 1);
    }
    if (cmd === 'serve') return Cli.serve(args);
    if (!args.at(1)) {
      Cli.usage();
      process.exit(1);
    }

    const opts: RunOptions = {
      target: args.at(1)!,
      noLlm: args.has('--no-llm'),
      provider: Cli.parseProvider(args.flag('--provider')),
      configPath: args.flag('--config'),
      maxSinks: args.numFlag('--max-sinks'),
      baseDir: args.flag('--out'),
      browser: args.has('--browser'),
      noBrowser: args.has('--no-browser'),
      allHosts: args.has('--all-hosts'),
      scopeHosts: args.list('--scope'),
    };

    const res = await runPipeline(opts);
    Cli.printResult(res);
  }

  // `serve` — run the local HTTP job API the Burp extension talks to (M2).
  private static serve(args: ArgParser): void {
    startCoreServer({
      port: args.numFlag('--port') ?? 8787,
      host: args.flag('--host') ?? '127.0.0.1',
      token: args.flag('--token') ?? process.env.JS_ANALYZER_HTTP_TOKEN,
    });
    // keep the process alive; the server owns the event loop
  }

  private static parseProvider(v?: string): RunOptions['provider'] {
    if (v === 'sdk' || v === 'claude-cli' || v === 'codex') return v;
    if (v) console.error(`[cli] unknown --provider '${v}', using config default`);
    return undefined;
  }

  private static printResult(res: RunResult): void {
    console.log(`\n✓ run ${res.runId}`);
    console.log(`  auth:     ${res.meta.auth}${res.meta.llmUsed ? '' : ' (static only)'}`);
    console.log(`  report:   ${res.reportPath}`);
    console.log(`  sinks:    ${res.meta.counts.sinks}  analyzed: ${res.meta.counts.analyzed}`);
    console.log(`  findings: ${res.meta.counts.findings}  confirmed: ${res.meta.counts.confirmed}`);
    console.log(`  assets:   ${res.meta.counts.assets}`);
    console.log(`  dir:      ${res.dir}`);
  }

  private static usage(): void {
    console.log(`JS Analyzer Agent — multi-agent JS vulnerability analyzer (v0.1)

Usage:
  js-analyzer analyze <file|dir|url> [options]
  js-analyzer serve [--port 8787] [--host 127.0.0.1] [--token T]   local HTTP job API (for Burp extension)

Options:
  --no-llm            deterministic static pass only (no API calls)
  --provider <p>      LLM backend: sdk (default) | claude-cli (claude -p) | codex (codex exec)
  --max-sinks <K>     cap sinks sent to the LLM (0/omitted = analyze all)
  --config <path>     config file (default ./js-analyzer.config.json)
  --out <dir>         base dir for runs/ output (default cwd)
  --help              show this help

Page discovery (URL targets):
  a non-.js URL is loaded in headless chromium and its JS is discovered
  --browser           force page discovery (e.g. for a .js-looking URL)
  --no-browser        force raw fetch of the URL (no browser)
  --scope <h1,h2>     extra in-scope hosts to include
  --all-hosts         include third-party JS (default: same site only)

Auth (any one enables the LLM analysis + FP judge stages):
  ANTHROPIC_API_KEY            Anthropic API key
  CLAUDE_CODE_OAUTH_TOKEN      Claude subscription OAuth token (or ANTHROPIC_AUTH_TOKEN)
  ~/.claude/.credentials.json  auto-detected after 'claude login'
Without any of these, only the deterministic static pass runs.`);
  }
}

new Cli(process.argv.slice(2)).run().catch((e) => {
  console.error(`✗ ${e?.stack || e}`);
  process.exit(1);
});
