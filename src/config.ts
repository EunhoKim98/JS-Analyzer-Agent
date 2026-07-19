import * as fs from 'fs';
import * as path from 'path';
import { JsAnalConfig } from './types';

const DEFAULTS: JsAnalConfig = {
  models: { analyze: 'claude-sonnet-5', judge: 'claude-opus-4-8' },
  maxSinks: 0, // 0 = analyze all ranked sinks (no cap)
  analyzeVendorSinks: false, // vendor/library files → CVE path, not per-sink LLM
  concurrency: 4,
  temperature: 0,
  maxTokensPerCall: 2048,
  active: { enabled: false, proxy: null, headers: {}, cookies: {}, scope: [] },
};

// Deep-merge a partial config file over the defaults.
export function loadConfig(configPath?: string): JsAnalConfig {
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
          ...DEFAULTS,
          ...raw,
          models: { ...DEFAULTS.models, ...(raw.models || {}) },
          active: { ...DEFAULTS.active, ...(raw.active || {}) },
        };
      } catch (e) {
        console.error(`[config] failed to parse ${p}: ${(e as Error).message}`);
      }
    }
  }
  return { ...DEFAULTS };
}
