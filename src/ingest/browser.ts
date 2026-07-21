import { chromium } from 'playwright';
import { IngestedFile } from '../types';
import { contentHash } from './index';

export interface DiscoverOptions {
  scopeHosts?: string[]; // extra in-scope hosts beyond the target host
  allHosts?: boolean; // include third-party JS
  timeoutMs?: number;
}

// 브라우저 탐색기 — Claude Code/CLI 취득 프런트엔드(DESIGN.md §4.11). 페이지 URL을
// 헤드리스 크로미움으로 로드해 외부 스크립트(네트워크 응답)·인라인 <script>·동적 주입
// 스크립트까지 모든 JS를 수집한다. FileIngestor와 함께 취득 전략의 다른 한 축이다.
export class BrowserDiscoverer {
  async discover(url: string, opts: DiscoverOptions = {}): Promise<IngestedFile[]> {
    const target = BrowserDiscoverer.safeUrl(url);
    const inScope = (u: string): boolean => {
      if (opts.allHosts) return true;
      const h = BrowserDiscoverer.safeUrl(u)?.hostname;
      if (!h || !target) return false;
      if (h === target.hostname) return true;
      if (h.endsWith('.' + BrowserDiscoverer.baseDomain(target.hostname))) return true;
      return (opts.scopeHosts || []).includes(h);
    };

    const browser = await chromium.launch({ headless: true });
    const collected = new Map<string, string>();
    const pending: Promise<void>[] = [];
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();

      page.on('response', (res) => {
        pending.push(
          (async () => {
            try {
              const rurl = res.url();
              const ct = (res.headers()['content-type'] || '').toLowerCase();
              const isJs = ct.includes('javascript') || ct.includes('ecmascript') || /\.m?js(\?|#|$)/i.test(rurl);
              if (!isJs || !res.ok() || !inScope(rurl)) return;
              const body = await res.text();
              if (body && body.trim()) collected.set(rurl, body);
            } catch {
              /* body not available (redirect, etc.) — skip */
            }
          })(),
        );
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout: opts.timeoutMs ?? 30000 }).catch(() => {});
      await page.waitForTimeout(400);
      const inlines: string[] = await page
        .$$eval('script:not([src])', (els) => els.map((e) => e.textContent || '').filter((t) => t.trim().length > 0))
        .catch(() => []);
      await Promise.allSettled(pending);
      await ctx.close();

      const files: IngestedFile[] = [];
      let idx = 0;
      for (const [rurl, code] of collected) {
        files.push({ file: BrowserDiscoverer.nameFromUrl(rurl, idx++), code, origin: 'raw', contentHash: contentHash(code) });
      }
      inlines.forEach((code, i) => {
        files.push({ file: `inline-${i + 1}.js`, code, origin: 'raw', contentHash: contentHash(code) });
      });
      return files;
    } finally {
      await browser.close();
    }
  }

  private static safeUrl(u: string): URL | null {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  }

  // Naive registrable domain (last two labels) — enough for same-site scoping.
  private static baseDomain(host: string): string {
    const parts = host.split('.');
    return parts.length <= 2 ? host : parts.slice(-2).join('.');
  }

  private static nameFromUrl(u: string, idx: number): string {
    const parsed = BrowserDiscoverer.safeUrl(u);
    const base = parsed ? parsed.pathname.split('/').pop() || `script-${idx}.js` : `script-${idx}.js`;
    return /\.m?js$/i.test(base) ? base : `${base || 'script'}-${idx}.js`;
  }
}
