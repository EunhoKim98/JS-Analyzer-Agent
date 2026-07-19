import * as fs from 'fs';
import * as path from 'path';

// Schema-based state store (DESIGN.md §4.4). One directory per run.
export class RunStore {
  readonly dir: string;

  constructor(baseDir: string, runId: string) {
    this.dir = path.join(baseDir, 'runs', runId);
    fs.mkdirSync(path.join(this.dir, 'raw'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'reconstructed'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'trace'), { recursive: true });
  }

  writeJson(name: string, data: unknown): void {
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(data, null, 2));
  }

  appendJsonl(name: string, rows: unknown[]): void {
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    fs.appendFileSync(path.join(this.dir, name), text);
  }

  writeText(name: string, text: string): void {
    fs.writeFileSync(path.join(this.dir, name), text);
  }

  writeReconstructed(file: string, code: string): void {
    const safe = file.replace(/[^A-Za-z0-9_.\-]/g, '_');
    fs.writeFileSync(path.join(this.dir, 'reconstructed', safe), code);
  }

  trace(agent: string, record: unknown): void {
    fs.appendFileSync(
      path.join(this.dir, 'trace', `${agent}.jsonl`),
      JSON.stringify(record) + '\n',
    );
  }

  path(name: string): string {
    return path.join(this.dir, name);
  }
}

export function makeRunId(hash: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${hash.slice(0, 8)}`;
}
