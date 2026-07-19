import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IngestedFile } from '../types';

export function contentHash(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
}

// Resolve a target (file, directory, or URL) into a list of raw JS files.
export async function ingest(target: string): Promise<IngestedFile[]> {
  if (/^https?:\/\//i.test(target)) {
    return [await ingestUrl(target)];
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return ingestDir(target);
  }
  return [ingestFile(target)];
}

function ingestFile(file: string): IngestedFile {
  const code = fs.readFileSync(file, 'utf8');
  return { file: path.basename(file), code, origin: 'raw', contentHash: contentHash(code) };
}

function ingestDir(dir: string): IngestedFile[] {
  const out: IngestedFile[] = [];
  for (const entry of walk(dir)) {
    if (/\.(js|mjs|cjs)$/i.test(entry)) {
      const code = fs.readFileSync(entry, 'utf8');
      out.push({
        file: path.relative(dir, entry),
        code,
        origin: 'raw',
        contentHash: contentHash(code),
      });
    }
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function ingestUrl(url: string): Promise<IngestedFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const code = await res.text();
  const name = new URL(url).pathname.split('/').pop() || 'remote.js';
  return { file: name, code, origin: 'raw', contentHash: contentHash(code) };
}
