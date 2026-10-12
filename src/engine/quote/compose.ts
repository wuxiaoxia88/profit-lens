// 报价组合工具：重量段换算、按客户批量还原报价（没有价格表的客户以系统实际收费为准）。
import type { Model } from '../model';
import { inferQuote } from './infer';
import { zonePrice, type Quote, type QuoteZone } from './types';

/** 把报价换到另一组（更细的）重量段上表达，价格不变 */
export function rebandQuote(q: Quote, bps: number[]): Quote {
  if (bps.length === q.breakpoints.length && bps.every((b, i) => Math.abs(b - q.breakpoints[i]) < 1e-9)) return q;
  const zones: QuoteZone[] = q.zones.map((z) => ({
    ...z,
    prices: bps.map((b, i) => {
      const lower = i === 0 ? 0 : bps[i - 1];
      // 段内价格取该段上限处的报价；整段落在续重区间的留空（由续重计算）
      if (z.tail && lower >= z.tail.start - 1e-9) return null;
      const p = zonePrice({ ...z, tail: z.tail && b > z.tail.start + 1e-9 ? null : z.tail }, b, q.breakpoints);
      return Number.isFinite(p) ? p : null;
    }),
  }));
  return { ...q, breakpoints: bps, zones };
}

/** 一次遍历把行号按客户分组，再逐个客户推断报价（不回填统计，速度快） */
export function inferPerCustomer(m: Model, mask: Uint8Array, codes: number[]): Map<number, Quote> {
  const cust = m.data.dict.customer;
  const out = new Map<number, Quote>();
  if (!cust || !codes.length) return out;
  const want = new Int32Array(cust.values.length).fill(-1);
  codes.forEach((c, k) => (want[c] = k));
  const counts = new Int32Array(codes.length);
  for (let i = 0; i < m.n; i++) { const k = want[cust.codes[i]]; if (k >= 0 && mask[i]) counts[k]++; }
  const lists = codes.map((_, k) => new Int32Array(counts[k]));
  const fill = new Int32Array(codes.length);
  for (let i = 0; i < m.n; i++) { const k = want[cust.codes[i]]; if (k >= 0 && mask[i]) lists[k][fill[k]++] = i; }
  codes.forEach((c, k) => {
    if (lists[k].length < 5) return;
    try {
      out.set(c, inferQuote(m, mask, { rows: lists[k], stats: false }).quote);
    } catch {
      /* 有效单太少，跳过 */
    }
  });
  return out;
}
