// Web Worker：在后台线程解析文件，主界面不卡顿。
import { transferablesOf } from '../engine/dataset';
import { loadFiles, probeFile, type LoadJob, type ProbeResult } from '../engine/load';

type Req =
  | { type: 'probe'; id: number; files: File[] }
  | { type: 'load'; id: number; jobs: { file: File; probe: ProbeResult }[] };

const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === 'probe') {
      const probes: ProbeResult[] = [];
      for (const f of msg.files) probes.push(await probeFile(f, f.name));
      ctx.postMessage({ type: 'probed', id: msg.id, probes });
    } else {
      const jobs: LoadJob[] = msg.jobs;
      const data = await loadFiles(jobs, (fileIndex, fraction, rows) => ctx.postMessage({ type: 'progress', id: msg.id, fileIndex, fraction, rows }));
      ctx.postMessage({ type: 'loaded', id: msg.id, data }, transferablesOf(data));
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
