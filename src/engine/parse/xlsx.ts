// 流式 XLSX 解析：逐字节扫描 sheet XML，不构造 DOM，也不为每个单元格创建字符串。
// 百万行导出解压后约 1.4GB XML，这是唯一能在浏览器里稳定跑完的方式。
import { listEntries, readEntryText, streamEntry, type ZipEntry } from './zip';

export interface CellSink {
  /** 原始 UTF-8 字节区间（数字、无转义的文本） */
  cellBytes(col: number, buf: Uint8Array, start: number, end: number): void;
  /** 已解码字符串（共享字符串、含 XML 转义的文本、CSV） */
  cellString(col: number, s: string): void;
  /** 行结束；返回 false 表示停止解析 */
  endRow(): boolean | void;
}

const LT = 60, GT = 62, SLASH = 47, SPACE = 32, QUOTE = 34, AMP = 38, EQ = 61;
const C_c = 99, C_r = 114, C_o = 111, C_w = 119, C_t = 116, C_s = 115, C_v = 118, C_f = 102, C_i = 105, C_b = 98, C_e = 101;

const utf8 = new TextDecoder();

export function decodeXmlEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        return e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10));
    }
  });
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] ?? '';
    // 跳过注音（rPh）里的文本
    const clean = inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let s = '';
    let t: RegExpExecArray | null;
    tRe.lastIndex = 0;
    while ((t = tRe.exec(clean))) s += t[1];
    out.push(decodeXmlEntities(s));
  }
  return out;
}

async function firstSheetPath(blob: Blob, entries: ZipEntry[]): Promise<string> {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const wb = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const wbXml = await readEntryText(blob, wb);
    const relXml = await readEntryText(blob, rels);
    const sheet = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(wbXml) ?? /<sheet\b[^>]*?\bid="([^"]+)"/.exec(wbXml);
    if (sheet) {
      const relRe = new RegExp(`<Relationship\\b[^>]*?Id="${sheet[1]}"[^>]*?Target="([^"]+)"|<Relationship\\b[^>]*?Target="([^"]+)"[^>]*?Id="${sheet[1]}"`);
      const rel = relRe.exec(relXml);
      const target = rel?.[1] ?? rel?.[2];
      if (target) {
        const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        if (byName.has(path)) return path;
      }
    }
  }
  const fallback = entries.find((e) => /^xl\/worksheets\/sheet\d*\.xml$/.test(e.name));
  if (!fallback) throw new Error('xlsx 中找不到工作表');
  return fallback.name;
}

function colFromRef(buf: Uint8Array, i: number): number {
  let col = 0;
  for (;;) {
    const ch = buf[i];
    if (ch >= 65 && ch <= 90) col = col * 26 + (ch - 64);
    else if (ch >= 97 && ch <= 122) col = col * 26 + (ch - 96);
    else break;
    i++;
  }
  return col - 1;
}

function parseUIntBytes(buf: Uint8Array, s: number, e: number): number {
  let v = 0;
  for (let i = s; i < e; i++) {
    const d = buf[i] - 48;
    if (d >= 0 && d <= 9) v = v * 10 + d;
  }
  return v;
}

/**
 * 解析一段只包含完整 <row> 的 XML 字节。
 * 注意：这里刻意用手写循环代替 Uint8Array.indexOf —— 后者每次调用有固定开销，
 * 百万行 × 26 列 × 多次查找会慢 20 倍以上。
 * 返回 false 表示 sink 要求停止。
 */
function parseRows(buf: Uint8Array, end: number, sst: string[], sink: CellSink, state: { autoCol: number }): boolean {
  let p = 0;
  for (;;) {
    while (p < end && buf[p] !== LT) p++;
    if (p >= end) return true;
    const c1 = buf[p + 1];
    if (c1 === C_c && (buf[p + 2] === SPACE || buf[p + 2] === GT || buf[p + 2] === SLASH)) {
      let col = -1;
      let type = 0; // 0=数字 1=共享字符串 2=内联/公式字符串 3=布尔 4=错误
      let q = p + 2;
      for (; buf[q] !== GT; q++) {
        if (buf[q] !== SPACE || buf[q + 2] !== EQ) continue;
        const a = buf[q + 1];
        if (a === C_r) {
          col = colFromRef(buf, q + 4);
        } else if (a === C_t) {
          const t0 = buf[q + 4];
          if (t0 === C_s) type = buf[q + 5] === QUOTE ? 1 : 2;
          else if (t0 === C_i) type = 2;
          else if (t0 === C_b) type = 3;
          else if (t0 === C_e) type = 4;
        }
      }
      if (col < 0) col = state.autoCol;
      state.autoCol = col + 1;
      if (buf[q - 1] === SLASH) { p = q + 1; continue; }
      // 找值：<v>…</v> 或 <is><t>…</t></is>
      let x = q + 1;
      let vs = -1, ve = -1;
      for (let guard = 0; guard < 8; guard++) {
        while (x < end && buf[x] !== LT) x++;
        if (x >= end) break;
        const n1 = buf[x + 1];
        if (n1 === SLASH && buf[x + 2] === C_c && buf[x + 3] === GT) break; // </c>
        if (n1 === C_v && buf[x + 2] === GT) {
          vs = x + 3; ve = vs;
          while (buf[ve] !== LT) ve++;
          break;
        }
        if (n1 === C_t && (buf[x + 2] === GT || buf[x + 2] === SPACE)) {
          let g = x + 2;
          while (buf[g] !== GT) g++;
          if (buf[g - 1] === SLASH) { vs = ve = g + 1; break; } // <t/>
          vs = g + 1; ve = vs;
          while (buf[ve] !== LT) ve++;
          break;
        }
        if (n1 === C_f) {
          // 公式：跳过 <f>…</f> 或 <f/>
          let g = x + 2;
          while (buf[g] !== GT) g++;
          if (buf[g - 1] !== SLASH) {
            g++;
            while (buf[g] !== LT) g++;
            while (buf[g] !== GT) g++;
          }
          x = g + 1;
          continue;
        }
        x++;
      }
      if (vs >= 0 && ve > vs && type !== 4) {
        if (type === 1) {
          const idx = parseUIntBytes(buf, vs, ve);
          sink.cellString(col, sst[idx] ?? '');
        } else if (type === 2) {
          let amp = false;
          for (let k = vs; k < ve; k++) if (buf[k] === AMP) { amp = true; break; }
          if (amp) sink.cellString(col, decodeXmlEntities(utf8.decode(buf.subarray(vs, ve))));
          else sink.cellBytes(col, buf, vs, ve);
        } else {
          sink.cellBytes(col, buf, vs, ve);
        }
      }
      p = ve > 0 ? ve : q + 1;
    } else if (c1 === SLASH && buf[p + 2] === C_r && buf[p + 3] === C_o && buf[p + 4] === C_w && buf[p + 5] === GT) {
      state.autoCol = 0;
      if (sink.endRow() === false) return false;
      p += 6;
    } else if (c1 === C_r && buf[p + 2] === C_o && buf[p + 3] === C_w && (buf[p + 4] === SPACE || buf[p + 4] === GT || buf[p + 4] === SLASH)) {
      let q = p + 4;
      while (buf[q] !== GT) q++;
      state.autoCol = 0;
      if (buf[q - 1] === SLASH) {
        if (sink.endRow() === false) return false;
      }
      p = q + 1;
    } else {
      p++;
    }
  }
}

function lastIndexOfRowEnd(buf: Uint8Array): number {
  // 从尾部找 "</row>"
  for (let i = buf.length - 6; i >= 0; i--) {
    if (buf[i] === LT && buf[i + 1] === SLASH && buf[i + 2] === C_r && buf[i + 3] === C_o && buf[i + 4] === C_w && buf[i + 5] === GT) return i + 6;
  }
  return -1;
}

export interface XlsxStreamOptions {
  onProgress?: (fraction: number) => void;
}

export async function streamXlsx(blob: Blob, sink: CellSink, opts: XlsxStreamOptions = {}): Promise<void> {
  const entries = await listEntries(blob);
  const sheetPath = await firstSheetPath(blob, entries);
  const sheet = entries.find((e) => e.name === sheetPath)!;
  const sstEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const sst = sstEntry && sstEntry.size > 0 ? parseSharedStrings(await readEntryText(blob, sstEntry)) : [];

  let carry: Uint8Array = new Uint8Array(0);
  const state = { autoCol: 0 };
  let stopped = false;
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  const flush = (): boolean => {
    const buf = new Uint8Array(carry.length + pendingLen);
    buf.set(carry, 0);
    let o = carry.length;
    for (const c of pending) { buf.set(c, o); o += c.length; }
    pending = [];
    pendingLen = 0;
    const cut = lastIndexOfRowEnd(buf);
    if (cut < 0) { carry = buf; return true; }
    if (!parseRows(buf, cut, sst, sink, state)) { stopped = true; return false; }
    carry = buf.slice(cut);
    return true;
  };
  await streamEntry(
    blob,
    sheet,
    (chunk) => {
      if (stopped) return false;
      // 攒到约 1MB 再解析，减少拼接与回溯次数
      pending.push(chunk);
      pendingLen += chunk.length;
      if (pendingLen < 1 << 20) return;
      return flush();
    },
    (read) => opts.onProgress?.(sheet.compressedSize ? read / sheet.compressedSize : 0),
  );
  if (!stopped && (pendingLen || carry.length)) flush();
}
