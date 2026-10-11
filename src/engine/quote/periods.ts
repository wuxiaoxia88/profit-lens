// 调价识别：同一份导出可能跨越客户调价日（例如 8/6 起面单费 2.0 → 1.8）。
// 做法：每天取「票量最大的几个省份 × 1kg 以内」的众数运费作为当日价格指纹，指纹变化即为调价点。
import { NO_DATE, dayToString } from '../dataset';
import type { Model } from '../model';
import { round2 } from './types';

export interface PricePeriod {
  from: number; // 天序号（含）
  to: number; // 天序号（含）
  label: string;
  tickets: number;
  /** 该时段的价格指纹：省份 → 1kg 内众数运费 */
  signature: Record<string, number>;
}

const MIN_CELL = 15; // 某省当天至少这么多票，众数才可信

export function detectPricePeriods(m: Model, mask: Uint8Array, topN = 6): PricePeriod[] {
  const day = m.day, w = m.cols.weight, price = m.cols.price;
  if (!day || !w || !price || !Number.isFinite(m.minDay)) return [];
  // 选票量最大的省份
  const provCount = new Float64Array(m.provNames.length);
  for (let i = 0; i < m.n; i++) if (mask[i]) provCount[m.prov[i]]++;
  const top = [...provCount.keys()].sort((a, b) => provCount[b] - provCount[a]).slice(0, topN).filter((p) => provCount[p] > 0);
  const slot = new Int32Array(m.provNames.length).fill(-1);
  top.forEach((p, k) => (slot[p] = k));

  const D = m.maxDay - m.minDay + 1;
  const hist: Map<number, number>[][] = Array.from({ length: D }, () => top.map(() => new Map()));
  const dayTickets = new Float64Array(D);
  for (let i = 0; i < m.n; i++) {
    if (!mask[i] || day[i] === NO_DATE) continue;
    const d = day[i] - m.minDay;
    dayTickets[d]++;
    const k = slot[m.prov[i]];
    if (k < 0 || !(w[i] > 0) || w[i] > 1 || !(price[i] > 0)) continue;
    const p = round2(price[i]);
    const h = hist[d][k];
    h.set(p, (h.get(p) ?? 0) + 1);
  }
  const sigOf = (d: number): (number | null)[] =>
    hist[d].map((h) => {
      let best: number | null = null, bc = 0, total = 0;
      for (const [p, c] of h) { total += c; if (c > bc) { bc = c; best = p; } }
      return total >= MIN_CELL ? best : null;
    });

  const periods: { from: number; to: number; sig: (number | null)[] }[] = [];
  for (let d = 0; d < D; d++) {
    if (!dayTickets[d]) continue;
    const s = sigOf(d);
    const cur = periods[periods.length - 1];
    const differs = cur && s.some((v, k) => v !== null && cur.sig[k] !== null && Math.abs(v - cur.sig[k]!) > 0.005);
    if (!cur || differs) {
      // 需要连续两天都是新价格才算调价，避免单日异常
      if (cur && differs) {
        let next = d + 1;
        while (next < D && !dayTickets[next]) next++;
        if (next < D) {
          const s2 = sigOf(next);
          const confirmed = s2.some((v, k) => v !== null && s[k] !== null && Math.abs(v - s[k]!) <= 0.005 && cur.sig[k] !== null && Math.abs(v - cur.sig[k]!) > 0.005);
          if (!confirmed) { cur.to = d; continue; }
        }
      }
      periods.push({ from: d, to: d, sig: s });
    } else {
      cur.to = d;
      s.forEach((v, k) => { if (cur.sig[k] === null) cur.sig[k] = v; });
    }
  }
  return periods.map((p) => {
    let tickets = 0;
    for (let d = p.from; d <= p.to; d++) tickets += dayTickets[d];
    const from = p.from + m.minDay, to = p.to + m.minDay;
    const signature: Record<string, number> = {};
    top.forEach((pi, k) => { if (p.sig[k] !== null) signature[m.provNames[pi]] = p.sig[k]!; });
    return { from, to, tickets, signature, label: `${dayToString(from).slice(5)} ~ ${dayToString(to).slice(5)}` };
  });
}

/** 生成某时段的掩码（与已有筛选取交集） */
export function periodMask(m: Model, mask: Uint8Array, p: PricePeriod): Uint8Array {
  const out = new Uint8Array(m.n);
  const day = m.day!;
  for (let i = 0; i < m.n; i++) out[i] = mask[i] && day[i] >= p.from && day[i] <= p.to ? 1 : 0;
  return out;
}
