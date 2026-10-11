import { bandIndex } from '../bands';
import type { PriceBasis } from '../model';

/** 续重取整方式 */
export type Rounding = 'ceil' | 'exact' | 'ceil0.5';

export const ROUNDING_LABEL: Record<Rounding, string> = {
  ceil: '向上取整(1kg)',
  'ceil0.5': '向上取整(0.5kg)',
  exact: '按实重',
};

/** 续重规则：重量 > start 时，价格 = base + perKg × g(重量 − start) */
export interface TailRule {
  start: number;
  base: number;
  perKg: number;
  rounding: Rounding;
}

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
  return round2(t.base + t.perKg * gOf(w - t.start, t.rounding));
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
    a.rounding === b.rounding
  );
}

export function describeTail(t: TailRule): string {
  const g = t.rounding === 'exact' ? `(重量−${t.start})` : t.rounding === 'ceil' ? `⌈重量−${t.start}⌉` : `⌈(重量−${t.start})×2⌉÷2`;
  return `>${t.start}kg：${t.base} + ${t.perKg}×${g}`;
}

const CN = '一二三四五六七八九十';
export function zoneName(i: number): string {
  if (i < 10) return CN[i] + '区';
  if (i < 19) return '十' + CN[i - 10] + '区';
  return `${i + 1}区`;
}
