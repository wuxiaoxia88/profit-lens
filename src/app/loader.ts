// 主线程侧的解析调用：优先用 Web Worker，创建失败（个别浏览器的本地文件限制）时退回主线程解析。
import type { DatasetData } from '../engine/dataset';
import { loadFiles, probeFile, type ProbeResult } from '../engine/load';
import LoaderWorker from './worker?worker&inline';

export interface Progress {
  fileIndex: number;
  fraction: number;
  rows: number;
}

let worker: Worker | null | undefined;
let seq = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new LoaderWorker();
  } catch {
    worker = null;
  }
  return worker;
}

function call<T>(payload: Record<string, unknown>, onProgress?: (p: Progress) => void): Promise<T> {
  const w = getWorker()!;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') { onProgress?.(m); return; }
      w.removeEventListener('message', handler);
      if (m.type === 'error') reject(new Error(m.message));
      else resolve(m as T);
    };
    const onError = (ev: Event) => {
      ev.preventDefault?.();
      w.removeEventListener('message', handler);
      reject(new Error('Worker 启动失败'));
    };
    w.addEventListener('message', handler);
    w.addEventListener('error', onError, { once: true });
    w.postMessage({ ...payload, id });
  });
}

export async function probe(files: File[]): Promise<ProbeResult[]> {
  if (getWorker()) {
    try {
      return (await call<{ probes: ProbeResult[] }>({ type: 'probe', files })).probes;
    } catch (e) {
      if (!(e instanceof Error) || !/postMessage|clone|Worker/i.test(e.message)) throw e;
      worker = null;
    }
  }
  const out: ProbeResult[] = [];
  for (const f of files) out.push(await probeFile(f, f.name));
  return out;
}

export async function load(jobs: { file: File; probe: ProbeResult }[], onProgress: (p: Progress) => void): Promise<DatasetData> {
  if (getWorker()) return (await call<{ data: DatasetData }>({ type: 'load', jobs }, onProgress)).data;
  return loadFiles(jobs, (fileIndex, fraction, rows) => onProgress({ fileIndex, fraction, rows }));
}
