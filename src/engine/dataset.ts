// 列式数据集：数值列 Float64Array，文本列字典编码（Int32Array + 去重值表），日期列为「距 1970-01-01 的天数」。
// 100 万行 × 12 个数值列 ≈ 96MB，整体内存可控，分组聚合在毫秒级。
import type { DateField, DictField, FieldId, NumField } from './schema';

export const NO_DATE = -2147483648;

export interface DictColumn {
  codes: Int32Array;
  values: string[];
}

export interface SourceInfo {
  fileName: string;
  rows: number;
  format: 'xlsx' | 'csv' | 'demo';
}

export interface DatasetData {
  n: number;
  fields: FieldId[];
  num: Partial<Record<NumField, Float64Array>>;
  dict: Partial<Record<DictField, DictColumn>>;
  dates: Partial<Record<DateField, Int32Array>>;
  waybill?: { bytes: Uint8Array; offsets: Uint32Array };
  sources: SourceInfo[];
}

export function transferablesOf(d: DatasetData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of Object.values(d.num)) if (a) out.push(a.buffer as ArrayBuffer);
  for (const c of Object.values(d.dict)) if (c) out.push(c.codes.buffer as ArrayBuffer);
  for (const a of Object.values(d.dates)) if (a) out.push(a.buffer as ArrayBuffer);
  if (d.waybill) out.push(d.waybill.bytes.buffer as ArrayBuffer, d.waybill.offsets.buffer as ArrayBuffer);
  return out;
}

const dec = new TextDecoder();

export function waybillAt(d: DatasetData, i: number): string {
  if (!d.waybill) return '';
  const { bytes, offsets } = d.waybill;
  return dec.decode(bytes.subarray(offsets[i], offsets[i + 1]));
}

export function dayToString(day: number): string {
  if (day === NO_DATE) return '';
  const dt = new Date(day * 86400000);
  const m = dt.getUTCMonth() + 1;
  const dd = dt.getUTCDate();
  return `${dt.getUTCFullYear()}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
}

export function stringToDay(s: string): number {
  const m = /^\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) {
    const day = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
    return day === 0 ? NO_DATE : day;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 1000 && n < 2958465) return Math.floor(n) - 25569; // Excel 序列号
  return NO_DATE;
}

/** 数值列（去掉 NaN）的合计 */
export function sumOf(a: Float64Array | undefined, mask?: Uint8Array): number {
  if (!a) return 0;
  let s = 0;
  if (mask) {
    for (let i = 0; i < a.length; i++) if (mask[i]) { const v = a[i]; if (v === v) s += v; }
  } else {
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) s += v; }
  }
  return s;
}
