// 报价核对与调价模拟：逐单计算「应收」，与「实收」比对；或用新报价重算收入和利润。
import { computeBands } from '../bands';
import type { Model } from '../model';
import { PRICE_TOL, zonePrice, type Quote } from './types';

export const CheckStatus = {
  Match: 0,
  Over: 1, // 实收 > 应收（多收）
  Under: 2, // 实收 < 应收（少收）
  NoQuote: 3, // 报价里没有这个省份 / 重量段
  Skipped: 4, // 不在筛选范围，或重量/运费为 0 的异常单
} as const;

export const STATUS_LABEL = ['一致', '多收', '少收', '无报价', '未参与'];

/** 省份序号 → 分区序号（-1 = 报价未覆盖） */
export function zoneOfProvince(m: Model, q: Quote): Int32Array {
  const byName = new Map<string, number>();
  q.zones.forEach((z, zi) => z.provinces.forEach((p) => byName.set(p, zi)));
  return Int32Array.from(m.provNames, (p) => byName.get(p) ?? -1);
}

/** 每行所属分区（-1 = 未覆盖） */
export function rowZones(m: Model, q: Quote): Int32Array {
  const pz = zoneOfProvince(m, q);
  const out = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) out[i] = pz[m.prov[i]];
  return out;
}

export function expectedPrices(m: Model, q: Quote, zones: Int32Array): Float64Array {
  const w = m.cols.weight!;
  const out = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const z = zones[i];
    out[i] = z < 0 ? NaN : zonePrice(q.zones[z], w[i], q.breakpoints);
  }
  return out;
}

export interface CheckCell {
  n: number;
  match: number;
  over: number;
  under: number;
  noQuote: number;
  diff: number; // Σ(实收 − 应收)
}

export interface CheckResult {
  expected: Float64Array;
  status: Uint8Array;
  zones: Int32Array;
  bands: Uint8Array;
  total: CheckCell;
  /** [分区][段]，段数 = breakpoints.length + 1；最后一行是未覆盖省份 */
  cells: CheckCell[][];
}

const emptyCell = (): CheckCell => ({ n: 0, match: 0, over: 0, under: 0, noQuote: 0, diff: 0 });

export function checkQuote(m: Model, q: Quote, mask: Uint8Array): CheckResult {
  const zones = rowZones(m, q);
  const expected = expectedPrices(m, q, zones);
  const bands = computeBands(m.cols.weight!, q.breakpoints);
  const price = m.cols.price!;
  const w = m.cols.weight!;
  const status = new Uint8Array(m.n);
  const B = q.breakpoints.length + 1;
  const cells = Array.from({ length: q.zones.length + 1 }, () => Array.from({ length: B }, emptyCell));
  const total = emptyCell();
  for (let i = 0; i < m.n; i++) {
    if (!mask[i] || !(w[i] > 0) || !(price[i] > 0)) { status[i] = CheckStatus.Skipped; continue; }
    const z = zones[i];
    const cell = cells[z < 0 ? q.zones.length : z][bands[i]];
    cell.n++; total.n++;
    const e = expected[i];
    if (e !== e) { status[i] = CheckStatus.NoQuote; cell.noQuote++; total.noQuote++; continue; }
    const d = price[i] - e;
    if (d > PRICE_TOL) { status[i] = CheckStatus.Over; cell.over++; total.over++; }
    else if (d < -PRICE_TOL) { status[i] = CheckStatus.Under; cell.under++; total.under++; }
    else { status[i] = CheckStatus.Match; cell.match++; total.match++; }
    cell.diff += d; total.diff += d;
  }
  return { expected, status, zones, bands, total, cells };
}

export interface SimCell {
  n: number;
  oldPrice: number;
  newPrice: number;
  income: number;
  cost: number;
  profit: number;
  newProfit: number;
  /** 增值收入合计（报价不含增值费，建议价需扣除） */
  va: number;
}

export interface SimResult {
  total: SimCell;
  /** [分区][段]，最后一行为未覆盖省份（价格不变） */
  cells: SimCell[][];
}

const emptySim = (): SimCell => ({ n: 0, oldPrice: 0, newPrice: 0, income: 0, cost: 0, profit: 0, newProfit: 0, va: 0 });

/**
 * 调价模拟：新收入 = 原收入 − 原运费 + 新运费（增值收入不变），成本不变。
 * 给了 base（原报价）时，新运费 = 实收运费 +（新报价 − 原报价），只体现改价本身的影响，
 * 原本就和报价不符的例外单保持原有差异；否则新运费 = 新报价。
 * 新报价覆盖不到的单（无报价）按原价计算。
 */
export function simulateQuote(m: Model, q: Quote, mask: Uint8Array, base?: Quote): SimResult {
  const zones = rowZones(m, q);
  const expected = expectedPrices(m, q, zones);
  const baseExp = base ? expectedPrices(m, base, rowZones(m, base)) : null;
  const bands = computeBands(m.cols.weight!, q.breakpoints);
  const price = m.cols.price!;
  const income = m.cols.income!;
  const cost = m.cols.cost!;
  const vaCol = m.cols.inVA;
  const B = q.breakpoints.length + 1;
  const cells = Array.from({ length: q.zones.length + 1 }, () => Array.from({ length: B }, emptySim));
  const total = emptySim();
  for (let i = 0; i < m.n; i++) {
    if (!mask[i]) continue;
    const z = zones[i];
    const cell = cells[z < 0 ? q.zones.length : z][bands[i]];
    const oldP = price[i] || 0;
    const e = expected[i];
    let newP = oldP;
    if (e === e && price[i] > 0) {
      if (!baseExp) newP = e;
      else if (baseExp[i] === baseExp[i]) newP = oldP + e - baseExp[i];
      else newP = e;
    }
    const inc = income[i] || 0;
    const c = cost[i] || 0;
    const prof = inc - c;
    const newProf = prof + newP - oldP;
    const va = vaCol ? vaCol[i] || 0 : 0;
    for (const t of [cell, total]) {
      t.n++; t.oldPrice += oldP; t.newPrice += newP; t.income += inc; t.cost += c; t.profit += prof; t.newProfit += newProf; t.va += va;
    }
  }
  return { total, cells };
}
