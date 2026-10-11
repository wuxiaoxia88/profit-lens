// 极简 ZIP 读取器：只读中央目录，按条目流式解压。
// 优先用浏览器原生 DecompressionStream('deflate-raw')（C++ 实现，最快），不支持时退回 fflate。
import { Inflate } from 'fflate';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

export async function isZip(blob: Blob): Promise<boolean> {
  const head = await readBytes(blob, 0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export async function listEntries(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 65536 + 22);
  const tail = await readBytes(blob, blob.size - tailLen, blob.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（找不到 ZIP 目录）');
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator >= 0 && u32(tail, locator) === 0x07064b50) {
      const z64Offset = u64(tail, locator + 8);
      const z64 = await readBytes(blob, z64Offset, z64Offset + 56);
      count = u64(z64, 32);
      cdSize = u64(z64, 40);
      cdOffset = u64(z64, 48);
    }
  }
  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localHeaderOffset = u32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 扩展字段
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cd, q); }
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const hasNativeInflate = (() => {
  try {
    // eslint-disable-next-line no-new
    new DecompressionStream('deflate-raw' as CompressionFormat);
    return true;
  } catch {
    return false;
  }
})();

/** 流式读取条目内容，逐块回调。返回 false 可提前终止。 */
export async function streamEntry(
  blob: Blob,
  entry: ZipEntry,
  onChunk: (chunk: Uint8Array) => boolean | void,
  onCompressedProgress?: (readBytes: number) => void,
): Promise<void> {
  const lh = await readBytes(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (u32(lh, 0) !== 0x04034b50) throw new Error('ZIP 本地头损坏：' + entry.name);
  const dataStart = entry.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const raw = blob.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    const reader = raw.stream().getReader();
    let done = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      done += r.value.length;
      onCompressedProgress?.(done);
      if (onChunk(r.value) === false) { await reader.cancel(); return; }
    }
    return;
  }
  if (entry.method !== 8) throw new Error(`不支持的压缩方式 ${entry.method}`);

  if (hasNativeInflate) {
    let compressedRead = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        compressedRead += chunk.length;
        onCompressedProgress?.(compressedRead);
        ctl.enqueue(chunk);
      },
    });
    const stream = raw.stream().pipeThrough(counter).pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat) as unknown as TransformStream<Uint8Array, Uint8Array>);
    const reader = stream.getReader();
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      if (onChunk(r.value) === false) { await reader.cancel(); return; }
    }
    return;
  }

  // fflate 兜底
  let stop = false;
  const inflater = new Inflate((chunk) => {
    if (!stop && onChunk(chunk) === false) stop = true;
  });
  const reader = raw.stream().getReader();
  let compressedRead = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) { inflater.push(new Uint8Array(0), true); break; }
    compressedRead += r.value.length;
    onCompressedProgress?.(compressedRead);
    inflater.push(r.value, false);
    if (stop) { await reader.cancel(); return; }
  }
}

export async function readEntryText(blob: Blob, entry: ZipEntry): Promise<string> {
  const parts: Uint8Array[] = [];
  let total = 0;
  await streamEntry(blob, entry, (c) => { parts.push(c); total += c.length; });
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder().decode(all);
}
