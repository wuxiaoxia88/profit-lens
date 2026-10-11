// 数据集构建器：作为解析器的 CellSink，把单元格直接写入列式数组。
import type { CellSink } from './parse/xlsx';
import { NO_DATE, type DatasetData, type DictColumn, type SourceInfo } from './dataset';
import { FIELD_BY_ID, type ColumnMapping, type DateField, type DictField, type FieldId, type NumField } from './schema';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 从字节直接解析十进制数（支持负号、小数、千分位逗号；遇到指数等复杂情况退回 Number）。 */
export function parseNumberBytes(buf: Uint8Array, s: number, e: number): number {
  while (s < e && buf[s] <= 32) s++;
  while (e > s && buf[e - 1] <= 32) e--;
  if (s >= e) return NaN;
  let neg = false;
  let i = s;
  if (buf[i] === 45) { neg = true; i++; } else if (buf[i] === 43) i++;
  let intPart = 0;
  let frac = 0;
  let scale = 1;
  let seenDigit = false;
  let dot = false;
  for (; i < e; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) {
      seenDigit = true;
      if (dot) { frac = frac * 10 + (c - 48); scale *= 10; }
      else intPart = intPart * 10 + (c - 48);
    } else if (c === 46 && !dot) dot = true;
    else if (c === 44 && !dot) continue;
    else return Number(dec.decode(buf.subarray(s, e)).replace(/,/g, ''));
  }
  if (!seenDigit) return NaN;
  // (整数部分×10^k + 小数部分) ÷ 10^k：两个精确整数相除，结果与 Number('1.91') 完全一致
  const whole = intPart * scale + frac;
  const v = scale === 1 ? intPart : whole <= Number.MAX_SAFE_INTEGER ? whole / scale : intPart + frac / scale;
  return neg ? -v : v;
}

export function parseNumberString(s: string): number {
  const t = s.trim().replace(/,/g, '').replace(/[¥￥元]/g, '');
  if (t === '' || t === '-') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

function parseDateBytes(buf: Uint8Array, s: number, e: number): number {
  // 快速路径：YYYY-MM-DD
  if (e - s >= 10 && buf[s + 4] === 45 && buf[s + 7] === 45) {
    const y = (buf[s] - 48) * 1000 + (buf[s + 1] - 48) * 100 + (buf[s + 2] - 48) * 10 + (buf[s + 3] - 48);
    const m = (buf[s + 5] - 48) * 10 + (buf[s + 6] - 48);
    const d = (buf[s + 8] - 48) * 10 + (buf[s + 9] - 48);
    if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
      return day === 0 ? NO_DATE : day;
    }
  }
  return parseDateString(dec.decode(buf.subarray(s, e)));
}

function parseDateString(s: string): number {
  const m = /^\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) {
    const day = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
    return day === 0 ? NO_DATE : day;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 1000 && n < 2958465) return Math.floor(n) - 25569;
  return NO_DATE;
}

/** 字节级字典编码：重复值不创建字符串，按哈希 + 字节比较命中。 */
class DictEncoder {
  values: string[] = [];
  private bytes: Uint8Array[] = [];
  private byHash = new Map<number, number[]>();
  private byString = new Map<string, number>();

  codeOfBytes(buf: Uint8Array, s: number, e: number): number {
    while (s < e && buf[s] <= 32) s++;
    while (e > s && buf[e - 1] <= 32) e--;
    let h = 0x811c9dc5;
    for (let i = s; i < e; i++) h = Math.imul(h ^ buf[i], 0x01000193);
    const bucket = this.byHash.get(h);
    const len = e - s;
    if (bucket) {
      outer: for (const code of bucket) {
        const b = this.bytes[code];
        if (b.length !== len) continue;
        for (let k = 0; k < len; k++) if (b[k] !== buf[s + k]) continue outer;
        return code;
      }
    }
    const str = dec.decode(buf.subarray(s, e));
    const existing = this.byString.get(str);
    if (existing !== undefined) return existing;
    return this.add(str, buf.slice(s, e), h);
  }

  codeOfString(raw: string): number {
    const str = raw.trim();
    const existing = this.byString.get(str);
    if (existing !== undefined) return existing;
    const b = enc.encode(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
    return this.add(str, b, h);
  }

  private add(str: string, b: Uint8Array, h: number): number {
    const code = this.values.length;
    this.values.push(str);
    this.bytes.push(b);
    this.byString.set(str, code);
    const bucket = this.byHash.get(h);
    if (bucket) bucket.push(code);
    else this.byHash.set(h, [code]);
    return code;
  }
}

type Handler =
  | { kind: 'num'; field: NumField }
  | { kind: 'dict'; field: DictField }
  | { kind: 'date'; field: DateField }
  | { kind: 'id' }
  | null;

export interface BuilderFileOptions {
  mapping: ColumnMapping;
  /** 表头所在行（0 起），其上方及表头行本身都跳过 */
  headerRow: number;
  source: SourceInfo;
}

export class DatasetBuilder implements CellSink {
  n = 0;
  private cap = 1 << 16;
  private num = new Map<NumField, Float64Array>();
  private dictCodes = new Map<DictField, Int32Array>();
  private dicts = new Map<DictField, DictEncoder>();
  private dates = new Map<DateField, Int32Array>();
  private wbBytes = new Uint8Array(1 << 20);
  private wbLen = 0;
  private wbOffsets = new Uint32Array(this.cap + 1);
  private hasWaybill = false;
  private sources: SourceInfo[] = [];

  // 当前文件状态
  private handlers: Handler[] = [];
  private skip = 0;
  private rowIndex = 0;
  private rowHasData = false;
  private curSource: SourceInfo | null = null;
  private fileStartN = 0;
  private emptyCode = new Map<DictField, number>();

  beginFile(opts: BuilderFileOptions): void {
    this.handlers = [];
    for (const [fid, col] of Object.entries(opts.mapping) as [FieldId, number][]) {
      if (col === undefined || col < 0) continue;
      const def = FIELD_BY_ID[fid];
      let h: Handler = null;
      if (def.kind === 'num') { h = { kind: 'num', field: fid as NumField }; this.ensureNum(fid as NumField); }
      else if (def.kind === 'dict') { h = { kind: 'dict', field: fid as DictField }; this.ensureDict(fid as DictField); }
      else if (def.kind === 'date') { h = { kind: 'date', field: fid as DateField }; this.ensureDate(fid as DateField); }
      else { h = { kind: 'id' }; this.ensureWaybill(); }
      this.handlers[col] = h;
    }
    this.skip = opts.headerRow + 1;
    this.rowIndex = 0;
    this.curSource = { ...opts.source };
    this.fileStartN = this.n;
    this.startRow();
  }

  endFile(): SourceInfo {
    const src = this.curSource!;
    src.rows = this.n - this.fileStartN;
    this.sources.push(src);
    this.curSource = null;
    return src;
  }

  private grow(): void {
    const cap = this.cap * 2;
    for (const [k, a] of this.num) { const b = new Float64Array(cap); b.set(a); this.num.set(k, b); }
    for (const [k, a] of this.dictCodes) { const b = new Int32Array(cap); b.set(a); this.dictCodes.set(k, b); }
    for (const [k, a] of this.dates) { const b = new Int32Array(cap); b.set(a); this.dates.set(k, b); }
    const o = new Uint32Array(cap + 1); o.set(this.wbOffsets); this.wbOffsets = o;
    this.cap = cap;
  }

  private ensureNum(f: NumField) {
    if (this.num.has(f)) return;
    const a = new Float64Array(this.cap);
    a.fill(NaN, 0, this.n + 1);
    this.num.set(f, a);
  }
  private ensureDict(f: DictField) {
    if (this.dictCodes.has(f)) return;
    const enc = new DictEncoder();
    this.dicts.set(f, enc);
    const empty = enc.codeOfString('');
    this.emptyCode.set(f, empty);
    const a = new Int32Array(this.cap);
    a.fill(empty, 0, this.n + 1);
    this.dictCodes.set(f, a);
  }
  private ensureDate(f: DateField) {
    if (this.dates.has(f)) return;
    const a = new Int32Array(this.cap);
    a.fill(NO_DATE, 0, this.n + 1);
    this.dates.set(f, a);
  }
  private ensureWaybill() {
    if (this.hasWaybill) return;
    this.hasWaybill = true;
    // 之前的行运单号为空：offset 全为 0 即可
  }

  /** 为当前行（索引 n）写入默认值 */
  private startRow() {
    if (this.n >= this.cap) this.grow();
    const i = this.n;
    for (const a of this.num.values()) a[i] = NaN;
    for (const [k, a] of this.dictCodes) a[i] = this.emptyCode.get(k)!;
    for (const a of this.dates.values()) a[i] = NO_DATE;
    this.wbOffsets[i + 1] = this.wbLen;
    this.rowHasData = false;
  }

  cellBytes(col: number, buf: Uint8Array, s: number, e: number): void {
    if (this.rowIndex < this.skip) return;
    const h = this.handlers[col];
    if (!h) return;
    const i = this.n;
    switch (h.kind) {
      case 'num': {
        const v = parseNumberBytes(buf, s, e);
        this.num.get(h.field)![i] = v;
        break;
      }
      case 'dict': {
        const code = this.dicts.get(h.field)!.codeOfBytes(buf, s, e);
        this.dictCodes.get(h.field)![i] = code;
        break;
      }
      case 'date':
        this.dates.get(h.field)![i] = parseDateBytes(buf, s, e);
        break;
      case 'id': {
        const len = e - s;
        if (this.wbLen + len > this.wbBytes.length) {
          const b = new Uint8Array(Math.max(this.wbBytes.length * 2, this.wbLen + len));
          b.set(this.wbBytes.subarray(0, this.wbLen));
          this.wbBytes = b;
        }
        this.wbBytes.set(buf.subarray(s, e), this.wbLen);
        this.wbLen += len;
        this.wbOffsets[i + 1] = this.wbLen;
        break;
      }
    }
    this.rowHasData = true;
  }

  cellString(col: number, str: string): void {
    if (this.rowIndex < this.skip) return;
    const h = this.handlers[col];
    if (!h) return;
    const i = this.n;
    switch (h.kind) {
      case 'num':
        this.num.get(h.field)![i] = parseNumberString(str);
        break;
      case 'dict':
        this.dictCodes.get(h.field)![i] = this.dicts.get(h.field)!.codeOfString(str);
        break;
      case 'date':
        this.dates.get(h.field)![i] = parseDateString(str);
        break;
      case 'id': {
        const b = enc.encode(str.trim());
        this.cellBytes(col, b, 0, b.length);
        return;
      }
    }
    if (str.trim() !== '') this.rowHasData = true;
  }

  endRow(): boolean {
    if (this.rowIndex++ < this.skip) return true;
    if (!this.rowHasData) { this.startRow(); return true; }
    this.n++;
    this.startRow();
    return true;
  }

  finish(): DatasetData {
    const n = this.n;
    const num: DatasetData['num'] = {};
    for (const [k, a] of this.num) num[k] = a.slice(0, n);
    const dict: DatasetData['dict'] = {};
    for (const [k, a] of this.dictCodes) dict[k] = { codes: a.slice(0, n), values: this.dicts.get(k)!.values } satisfies DictColumn;
    const dates: DatasetData['dates'] = {};
    for (const [k, a] of this.dates) dates[k] = a.slice(0, n);
    const fields = [...this.num.keys(), ...this.dictCodes.keys(), ...this.dates.keys()] as FieldId[];
    let waybill: DatasetData['waybill'];
    if (this.hasWaybill) {
      fields.push('waybill');
      waybill = { bytes: this.wbBytes.slice(0, this.wbLen), offsets: this.wbOffsets.slice(0, n + 1) };
    }
    return { n, fields, num, dict, dates, waybill, sources: this.sources };
  }
}

/** 探测用 sink：收集前若干行为字符串数组。 */
export class ProbeSink implements CellSink {
  rows: string[][] = [];
  private cur: string[] = [];
  constructor(private limit = 30) {}
  cellBytes(col: number, buf: Uint8Array, s: number, e: number): void {
    this.cur[col] = dec.decode(buf.subarray(s, e));
  }
  cellString(col: number, s: string): void {
    this.cur[col] = s;
  }
  endRow(): boolean {
    const r = Array.from(this.cur, (v) => v ?? '');
    this.rows.push(r);
    this.cur = [];
    return this.rows.length < this.limit;
  }
}
