// 流式 CSV 解析，自动识别 UTF-8 / GB18030（Excel 另存的中文 CSV 常是 GBK）。
import type { CellSink } from './xlsx';

export async function detectEncoding(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  // 截到最后一个换行，避免多字节字符被切断
  let end = head.length;
  if (blob.size > head.length) {
    const nl = head.lastIndexOf(10);
    if (nl > 0) end = nl;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, end));
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

export async function streamCsv(blob: Blob, sink: CellSink, onProgress?: (f: number) => void): Promise<void> {
  const encoding = await detectEncoding(blob);
  const decoder = new TextDecoder(encoding);
  const reader = blob.stream().getReader();
  let read = 0;
  let delimiter: string | null = null;

  // 解析状态（跨块保留）
  let field = '';
  let inQuotes = false;
  let quotePending = false; // 引号内遇到 " 后等待判断是否为转义
  let col = 0;
  let stopped = false;
  let first = true;

  const endField = () => {
    const v = field.trim();
    if (v !== '') sink.cellString(col, v);
    col++;
    field = '';
  };
  const endRow = () => {
    endField();
    col = 0;
    if (sink.endRow() === false) stopped = true;
  };

  const consume = (text: string) => {
    if (first) {
      first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (delimiter === null) {
      const line = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
      const counts: [string, number][] = [',', '\t', ';', '|'].map((d) => [d, line.split(d).length]);
      counts.sort((a, b) => b[1] - a[1]);
      delimiter = counts[0][1] > 1 ? counts[0][0] : ',';
    }
    const d = delimiter;
    let start = 0;
    for (let i = 0; i < text.length && !stopped; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (ch === '"') { field += '"'; start = i + 1; continue; }
          inQuotes = false;
          // 落到非引号状态处理当前字符
        } else {
          if (ch === '"') { field += text.slice(start, i); quotePending = true; start = i + 1; }
          continue;
        }
      }
      if (ch === '"' && field === '' && start === i) { inQuotes = true; start = i + 1; continue; }
      if (ch === d) { field += text.slice(start, i); endField(); start = i + 1; }
      else if (ch === '\n') {
        field += text.slice(start, i).replace(/\r$/, '');
        endRow();
        start = i + 1;
      }
    }
    if (!stopped) field += text.slice(start);
  };

  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    read += r.value.length;
    onProgress?.(read / blob.size);
    consume(decoder.decode(r.value, { stream: true }));
    if (stopped) { await reader.cancel(); return; }
  }
  consume(decoder.decode());
  if (!stopped && (field !== '' || col > 0)) endRow();
}
