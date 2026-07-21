import * as fs from 'fs';
import * as path from 'path';
import { JsAnalConfig } from './types';

// 설정 로더 — 기본값과 파일 설정을 병합하는 책임을 캡슐화한다(SRP).
// 기본값을 인스턴스 밖에서 상수로 두어 불변으로 공유한다.
export class ConfigLoader {
  private static readonly DEFAULTS: JsAnalConfig = {
    models: { analyze: 'claude-sonnet-5', judge: 'claude-opus-4-8' },
    provider: 'sdk', // sdk | claude-cli | codex — LLM 백엔드 선택(D4)
    maxSinks: 0, // 0 = analyze all ranked sinks (no cap)
    analyzeVendorSinks: false, // vendor/library files → CVE path, not per-sink LLM
    concurrency: 4,
    temperature: 0,
    maxTokensPerCall: 2048,
    active: { enabled: false, proxy: null, headers: {}, cookies: {}, scope: [] },
  };

  // Deep-merge a partial config file over the defaults (first existing wins).
  load(configPath?: string): JsAnalConfig {
    const candidates = [
      configPath,
      path.resolve(process.cwd(), 'js-analyzer.config.json'),
      path.resolve(process.cwd(), 'js-anal.config.json'), // legacy name
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
          return {
            ...ConfigLoader.DEFAULTS,
            ...raw,
            models: { ...ConfigLoader.DEFAULTS.models, ...(raw.models || {}) },
            active: { ...ConfigLoader.DEFAULTS.active, ...(raw.active || {}) },
          };
        } catch (e) {
          console.error(`[config] failed to parse ${p}: ${(e as Error).message}`);
        }
      }
    }
    return { ...ConfigLoader.DEFAULTS };
  }
}
