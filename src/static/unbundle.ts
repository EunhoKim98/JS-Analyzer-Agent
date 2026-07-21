import * as fs from 'fs';
import * as path from 'path';
import { js_beautify } from 'js-beautify';
import { SourceMapConsumer } from 'source-map';
import { IngestedFile } from '../types';
import { contentHash } from '../ingest';

// 언번들러(Stage [1]) — 소스맵이 있으면 원본 소스를 복원하고, 없으면 (대개 미니파이된)
// 코드를 beautify 해 AST 패스와 LLM이 읽을 수 있는 구조로 만든다. 결정론적이다.
export class Unbundler {
  async unbundle(f: IngestedFile, targetDir?: string): Promise<IngestedFile[]> {
    const smUrl = Unbundler.findSourceMapUrl(f.code);
    if (smUrl) {
      try {
        const recovered = await this.reconstructFromSourceMap(f, smUrl, targetDir);
        if (recovered.length) return recovered;
      } catch (e) {
        console.error(`[unbundle] sourcemap failed for ${f.file}: ${(e as Error).message}`);
      }
    }
    // Fallback: beautify in place.
    const pretty = Unbundler.safeBeautify(f.code);
    return [{ file: f.file, code: pretty, origin: 'beautified', contentHash: contentHash(pretty) }];
  }

  private async reconstructFromSourceMap(
    f: IngestedFile,
    smUrl: string,
    targetDir?: string,
  ): Promise<IngestedFile[]> {
    let rawMap: string | null = null;

    const dataUri = smUrl.match(/^data:application\/json[^,]*;base64,(.*)$/);
    if (dataUri) {
      rawMap = Buffer.from(dataUri[1], 'base64').toString('utf8');
    } else if (/^https?:\/\//i.test(smUrl)) {
      const res = await fetch(smUrl);
      if (res.ok) rawMap = await res.text();
    } else if (targetDir) {
      const p = path.resolve(targetDir, smUrl);
      if (fs.existsSync(p)) rawMap = fs.readFileSync(p, 'utf8');
    }
    if (!rawMap) return [];

    const parsed = JSON.parse(rawMap);
    const out: IngestedFile[] = [];
    await SourceMapConsumer.with(parsed, null, (consumer) => {
      const sources = consumer.sources || [];
      for (const src of sources) {
        const content = consumer.sourceContentFor(src, true);
        if (content && content.trim()) {
          const name = Unbundler.sanitizeName(src);
          out.push({ file: name, code: content, origin: 'sourcemap', contentHash: contentHash(content) });
        }
      }
    });
    return out;
  }

  private static safeBeautify(code: string): string {
    try {
      return js_beautify(code, { indent_size: 2, max_preserve_newlines: 2 });
    } catch {
      return code;
    }
  }

  private static findSourceMapUrl(code: string): string | null {
    const m = code.match(/[#@]\s*sourceMappingURL=([^\s'"]+)/);
    return m ? m[1] : null;
  }

  private static sanitizeName(src: string): string {
    return src.replace(/^webpack:\/\//, '').replace(/[?#].*$/, '').replace(/^\.\//, '') || 'unknown.js';
  }
}
