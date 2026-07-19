import * as fs from 'fs';
import * as path from 'path';
import { js_beautify } from 'js-beautify';
import { SourceMapConsumer } from 'source-map';
import { IngestedFile } from '../types';
import { contentHash } from '../ingest';

// Stage [1] Unbundle: reconstruct original sources from a sourcemap when
// available, otherwise beautify the (likely minified) code so the AST pass and
// the LLM see readable structure. Deterministic.
export async function unbundle(f: IngestedFile, targetDir?: string): Promise<IngestedFile[]> {
  const smUrl = findSourceMapUrl(f.code);
  if (smUrl) {
    try {
      const recovered = await reconstructFromSourceMap(f, smUrl, targetDir);
      if (recovered.length) return recovered;
    } catch (e) {
      console.error(`[unbundle] sourcemap failed for ${f.file}: ${(e as Error).message}`);
    }
  }
  // Fallback: beautify in place.
  const pretty = safeBeautify(f.code);
  return [{ file: f.file, code: pretty, origin: 'beautified', contentHash: contentHash(pretty) }];
}

function safeBeautify(code: string): string {
  try {
    return js_beautify(code, { indent_size: 2, max_preserve_newlines: 2 });
  } catch {
    return code;
  }
}

function findSourceMapUrl(code: string): string | null {
  const m = code.match(/[#@]\s*sourceMappingURL=([^\s'"]+)/);
  return m ? m[1] : null;
}

async function reconstructFromSourceMap(
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
        const name = sanitizeName(src);
        out.push({
          file: name,
          code: content,
          origin: 'sourcemap',
          contentHash: contentHash(content),
        });
      }
    }
  });
  return out;
}

function sanitizeName(src: string): string {
  return src.replace(/^webpack:\/\//, '').replace(/[?#].*$/, '').replace(/^\.\//, '') || 'unknown.js';
}
