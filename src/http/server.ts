import * as http from 'http';
import * as fs from 'fs';
import { JobStore, jobView } from './jobs';
import { RunOptions } from '../orchestrator/context';

export interface ServerOptions {
  port?: number;
  host?: string; // default 127.0.0.1 — localhost only (R5)
  token?: string; // optional bearer token for local isolation
}

// 로컬 HTTP 잡 서버(M2) — Node 내장 http만 사용(무의존). 엔드포인트:
//   POST /jobs            {target, provider?, ...RunOptions} → 202 {id}
//   GET  /jobs/:id        → 잡 상태 + meta
//   GET  /jobs/:id/report → 완료 시 report.html
//   GET  /health          → 200
// 기본 127.0.0.1 바인딩 + (옵션) Bearer 토큰으로 로컬 격리(R5). 라우팅·요청파싱만
// 담당하고 실제 분석은 JobStore→runPipeline에 위임한다(SRP).
export class HttpServer {
  constructor(
    private readonly store: JobStore,
    private readonly token?: string,
  ) {}

  listen(port = 8787, host = '127.0.0.1'): http.Server {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.listen(port, host, () => {
      console.error(`[http] js-analyzer core listening on http://${host}:${port}${this.token ? ' (token required)' : ''}`);
    });
    return server;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.token && req.headers.authorization !== `Bearer ${this.token}`) {
      return this.send(res, 401, { error: 'unauthorized' });
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') return this.send(res, 200, { ok: true });

    if (req.method === 'POST' && path === '/jobs') return this.createJob(req, res);

    const m = path.match(/^\/jobs\/([^/]+)(\/report)?$/);
    if (req.method === 'GET' && m) {
      const job = this.store.get(m[1]);
      if (!job) return this.send(res, 404, { error: 'job not found' });
      if (m[2]) return this.serveReport(res, job);
      return this.send(res, 200, jobView(job));
    }

    this.send(res, 404, { error: 'not found' });
  }

  private createJob(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024 * 1024) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return this.send(res, 413, { error: 'payload too large' });
      let opts: RunOptions;
      try {
        opts = JSON.parse(body || '{}');
      } catch {
        return this.send(res, 400, { error: 'invalid JSON body' });
      }
      if (!opts.target) return this.send(res, 400, { error: 'missing "target"' });
      const job = this.store.create(opts);
      this.send(res, 202, { id: job.id, status: job.status });
    });
  }

  private serveReport(res: http.ServerResponse, job: ReturnType<JobStore['get']>): void {
    if (!job || job.status !== 'done' || !job.result) {
      return this.send(res, 409, { error: `report not ready (status: ${job?.status})` });
    }
    try {
      const html = fs.readFileSync(job.result.reportPath, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      this.send(res, 500, { error: 'report file unreadable' });
    }
  }

  private send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
}
