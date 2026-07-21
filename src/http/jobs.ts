import * as crypto from 'crypto';
import { runPipeline } from '../orchestrator/pipeline';
import { RunOptions, RunResult, PipelineEvent } from '../orchestrator/context';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

type Subscriber = (e: PipelineEvent) => void;

export interface Job {
  id: string;
  status: JobStatus;
  opts: RunOptions;
  createdAt: number;
  result?: RunResult;
  error?: string;
  events: PipelineEvent[]; // buffer for SSE replay to late subscribers (D8)
  subscribers: Set<Subscriber>;
}

export interface Subscription {
  buffered: PipelineEvent[];
  unsubscribe: () => void;
}

// 잡 스토어 — 제출된 분석을 비동기로 실행하고 상태 + 스트리밍 이벤트를 보관한다(M2·D8).
// runPipeline의 onEvent를 잡별 버퍼+구독자에 팬아웃해, SSE가 늦게 붙어도 버퍼를 리플레이한다.
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(opts: RunOptions): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      status: 'queued',
      opts,
      createdAt: Date.now(),
      events: [],
      subscribers: new Set(),
    };
    this.jobs.set(job.id, job);
    void this.execute(job); // fire and forget; status/events polled or streamed
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  // SSE 구독 — 현재 버퍼 스냅샷을 돌려주고(즉시 리플레이용) 이후 이벤트를 fn으로 흘린다.
  // Node는 단일 스레드라 스냅샷~구독 등록 사이에 새 이벤트가 끼어들지 않는다(중복/누락 없음).
  subscribe(id: string, fn: Subscriber): Subscription | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const buffered = [...job.events];
    job.subscribers.add(fn);
    return { buffered, unsubscribe: () => job.subscribers.delete(fn) };
  }

  private async execute(job: Job): Promise<void> {
    job.status = 'running';
    const emit = (e: PipelineEvent) => {
      job.events.push(e);
      for (const s of job.subscribers) {
        try {
          s(e);
        } catch {
          /* a dead SSE connection must not break the job */
        }
      }
    };
    try {
      job.result = await runPipeline(job.opts, emit);
      job.status = 'done';
    } catch (e) {
      job.error = (e as Error)?.stack || String(e);
      job.status = 'error';
      emit({ type: 'error', message: (e as Error)?.message || String(e) });
    }
  }
}

// Public view of a job (no internal opts/subscribers leakage).
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
