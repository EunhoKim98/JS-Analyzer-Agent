import { JobStore } from './jobs';
import { HttpServer, ServerOptions } from './server';

export { JobStore } from './jobs';
export { HttpServer, ServerOptions } from './server';

// 코어 HTTP 서버 기동 진입점 — 합성(스토어+서버)만 담당한다. Burp 확장이 번들된
// 코어 바이너리를 `serve` 모드로 spawn 하면 이 함수가 실행된다(M2→M5).
export function startCoreServer(opts: ServerOptions = {}) {
  const store = new JobStore();
  const server = new HttpServer(store, opts.token);
  return server.listen(opts.port, opts.host);
}
