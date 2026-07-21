import * as crypto from 'crypto';
import { runPipeline } from '../orchestrator/pipeline';
import { RunOptions, RunResult } from '../orchestrator/context';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface Job {
  id: string;
  status: JobStatus;
  opts: RunOptions;
  createdAt: number;
  result?: RunResult;
  error?: string;
}

// 잡 스토어 — 제출된 분석을 비동기로 실행하고 상태를 보관한다(M2). Burp 확장이
// POST로 제출→폴링으로 결과를 받는 구조의 서버측 상태(DESIGN.md §10 로컬 HTTP API).
// runPipeline 을 감싸기만 하고 파이프라인 로직은 모른다(SRP).
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(opts: RunOptions): Job {
    const job: Job = { id: crypto.randomUUID(), status: 'queued', opts, createdAt: Date.now() };
    this.jobs.set(job.id, job);
    void this.execute(job); // fire and forget; status polled via get()
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private async execute(job: Job): Promise<void> {
    job.status = 'running';
    try {
      job.result = await runPipeline(job.opts);
      job.status = 'done';
    } catch (e) {
      job.error = (e as Error)?.stack || String(e);
      job.status = 'error';
    }
  }
}

// Public view of a job (no internal opts leakage beyond target).
export function jobView(job: Job) {
  return {
    id: job.id,
    status: job.status,
    target: job.opts.target,
    runId: job.result?.runId,
    meta: job.result?.meta,
    error: job.error,
  };
}
