import { bandIndex } from '../bands';
import type { PriceBasis } from '../model';

/** 续重取整方式 */
export type Rounding = 'ceil' | 'exact' | 'ceil0.5';

export const ROUNDING_LABEL: Record<Rounding, string> = {
  ceil: '向上取整(1kg)',
  'ceil0.5': '向上取整(0.5kg)',
  exact: '按实重',
};

/**
 * 续重规则：重量 > start 时，价格 = base + perKg × g(重量 − origin)。
 * origin 缺省等于 start。客户报价单常见两种写法：
 *   「3kg 以上 = 面单款 3 元 + 单价 × 整公斤数（从 0kg 开始）」→ start=3, origin=0, base=3
 *   「2kg 以上 = 首重 4 元 +（重量 − 1）× 单价」             → start=2, origin=1, base=4
 */
export interface TailRule {
  start: number;
  base: number;
  perKg: number;
  rounding: Rounding;
  origin?: number;
  /** 阶梯加价：重量超过 above 后，每个计费公斤再加 perKgAdd（如「北京5KG以上续重加收1元/公斤」） */
  steps?: { above: number; perKgAdd: number }[];
}

export const originOf = (t: TailRule) => t.origin ?? t.start;

export interface ZoneStats {
  tickets: number;
  matched: number;
  tailSamples: number;
  tailMatched: number;
  /** 续重规则是否由同区其他省份或默认值推断（本区样本不足） */
  tailLowConfidence?: boolean;
}

export interface QuoteZone {
  id: string;
  name: string;
  provinces: string[];
  /** 与 Quote.breakpoints 等长：第 i 段 (b[i-1], b[i]] 的价格；null 表示未报价 */
  prices: (number | null)[];
  tail: TailRule | null;
  stats?: ZoneStats;
}

export interface Quote {
  name: string;
  origin: 'inferred' | 'uploaded' | 'manual';
  basis: PriceBasis;
  breakpoints: number[];
  zones: QuoteZone[];
  /** 识别到的固定面单费（仅用于展示「其中面单费」） */
  sheetFee?: number;
  createdAt: string;
}

export const PRICE_TOL = 0.006;

export function round2(v: number): number {
  return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100;
}

export function gOf(x: number, r: Rounding): number {
  if (x <= 0) return 0;
  switch (r) {
    case 'ceil': return Math.ceil(x - 1e-9);
    case 'ceil0.5': return Math.ceil(x * 2 - 1e-9) / 2;
    case 'exact': return x;
  }
}

export function tailPrice(t: TailRule, w: number): number {
  const g = gOf(w - originOf(t), t.rounding);
  let perKg = t.perKg;
  if (t.steps) for (const st of t.steps) if (w > st.above + 1e-9) perKg += st.perKgAdd;
  return round2(t.base + perKg * g);
}

/** 按报价计算某分区某重量的应收价；返回 NaN 表示无报价 */
export function zonePrice(z: QuoteZone, w: number, bps: number[]): number {
  if (z.tail && w > z.tail.start + 1e-9) return tailPrice(z.tail, w);
  const b = bandIndex(w, bps);
  if (b < bps.length) {
    const p = z.prices[b];
    return p === null || p === undefined ? NaN : p;
  }
  return NaN;
}

export function sameTail(a: TailRule | null, b: TailRule | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.start - b.start) < 1e-9 &&
    Math.abs(a.base - b.base) < PRICE_TOL &&
    Math.abs(a.perKg - b.perKg) < 1e-6 &&
    a.rounding === b.rounding &&
    Math.abs(originOf(a) - originOf(b)) < 1e-9 &&
    JSON.stringify(a.steps ?? []) === JSON.stringify(b.steps ?? [])
  );
}

export function describeTail(t: TailRule): string {
  const o = originOf(t);
  const x = o === 0 ? '重量' : `重量−${o}`;
  const g = t.rounding === 'exact' ? `(${x})` : t.rounding === 'ceil' ? `⌈${x}⌉` : `⌈(${x})×2⌉÷2`;
  const steps = (t.steps ?? []).map((st) => `；>${st.above}kg 每kg +${st.perKgAdd}`).join('');
  return `>${t.start}kg：${t.base} + ${t.perKg}×${g}${steps}`;
}

const CN = '一二三四五六七八九十';
export function zoneName(i: number): string {
  if (i < 10) return CN[i] + '区';
  if (i < 19) return '十' + CN[i - 10] + '区';
  return `${i + 1}区`;
}
