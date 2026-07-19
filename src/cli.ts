#!/usr/bin/env node
import { runPipeline } from './orchestrator/pipeline';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}
function numFlag(argv: string[], name: string): number | undefined {
  const v = flag(argv, name);
  return v != null ? Number(v) : undefined;
}

function usage(): void {
  console.log(`JS Analyzer Agent — multi-agent JS vulnerability analyzer (v0.1)

Usage:
  js-analyzer analyze <file|dir|url> [options]

Options:
  --no-llm            deterministic static pass only (no API calls)
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv[0] !== 'analyze' || !argv[1]) {
    usage();
    process.exit(argv.includes('--help') ? 0 : 1);
  }
  const scope = flag(argv, '--scope');
  const res = await runPipeline({
    target: argv[1],
    noLlm: argv.includes('--no-llm'),
    configPath: flag(argv, '--config'),
    maxSinks: numFlag(argv, '--max-sinks'),
    baseDir: flag(argv, '--out'),
    browser: argv.includes('--browser'),
    noBrowser: argv.includes('--no-browser'),
    allHosts: argv.includes('--all-hosts'),
    scopeHosts: scope ? scope.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  });
  console.log(`\n✓ run ${res.runId}`);
  console.log(`  auth:     ${res.meta.auth}${res.meta.llmUsed ? '' : ' (static only)'}`);
  console.log(`  report:   ${res.reportPath}`);
  console.log(`  sinks:    ${res.meta.counts.sinks}  analyzed: ${res.meta.counts.analyzed}`);
  console.log(`  findings: ${res.meta.counts.findings}  confirmed: ${res.meta.counts.confirmed}`);
  console.log(`  assets:   ${res.meta.counts.assets}`);
  console.log(`  dir:      ${res.dir}`);
}

main().catch((e) => {
  console.error(`✗ ${e?.stack || e}`);
  process.exit(1);
});
