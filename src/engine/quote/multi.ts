// 多客户报价核对：一份导出里有很多结算对象，每个对象用自己的报价表核对，一次遍历完成。
import { NO_DATE, stringToDay } from '../dataset';
import type { Model } from '../model';
import { CheckStatus, systemMask, zoneOfProvince } from './check';
import { PRICE_TOL, zonePrice, type Quote } from './types';

/** 核对依据：价格表 / 系统实收还原 */
export type QuoteSource = 'sheet' | 'system';

export interface CustomerQuote {
  sheet: string;
  quote: Quote;
  effectiveFrom?: string;
  source: QuoteSource;
}

export interface CustomerCheck {
  code: number;
  sheet: string;
  source: QuoteSource;
  n: number;
  checked: number;
  match: number;
  over: number;
  under: number;
  noQuote: number;
  /** 揽收日期早于报价生效日，不参与核对 */
  before: number;
  /** 以系统为准的单：「以系统为准」省份偏离报价的单；没有价格表的客户偏离其收费规律的单（仅供参考） */
  system: number;
  overAmt: number;
  underAmt: number;
}

export interface MultiCheckResult {
  byCustomer: CustomerCheck[];
  /** 逐单状态（未分配报价的客户为 Skipped） */
  status: Uint8Array;
  expected: Float64Array;
}

export function checkCustomers(m: Model, mask: Uint8Array, assign: Map<number, CustomerQuote>, systemProvinces: string[] = []): MultiCheckResult {
  const sys = systemMask(m, systemProvinces);
  const cust = m.data.dict.customer;
  const status = new Uint8Array(m.n).fill(CheckStatus.Skipped);
  const expected = new Float64Array(m.n).fill(NaN);
  if (!cust || !m.cols.price || !m.cols.weight) return { byCustomer: [], status, expected };
  const compiled = new Map<number, { q: Quote; pz: Int32Array; from: number; stat: CustomerCheck }>();
  for (const [code, cq] of assign) {
    const from = cq.effectiveFrom ? stringToDay(cq.effectiveFrom) : NO_DATE;
    compiled.set(code, {
      q: cq.quote,
      pz: zoneOfProvince(m, cq.quote),
      from,
      stat: { code, sheet: cq.sheet, source: cq.source, n: 0, checked: 0, match: 0, over: 0, under: 0, noQuote: 0, before: 0, system: 0, overAmt: 0, underAmt: 0 },
    });
  }
  const price = m.cols.price, w = m.cols.weight, day = m.day;
  for (let i = 0; i < m.n; i++) {
    if (!mask[i]) continue;
    const c = compiled.get(cust.codes[i]);
    if (!c) continue;
    const st = c.stat;
    st.n++;
    if (!(w[i] > 0) || !(price[i] > 0)) continue;
    if (day && c.from !== NO_DATE && day[i] !== NO_DATE && day[i] < c.from) { st.before++; continue; }
    st.checked++;
    const z = c.pz[m.prov[i]];
    const e = z < 0 ? NaN : zonePrice(c.q.zones[z], w[i], c.q.breakpoints);
    expected[i] = e;
    const d = price[i] - e;
    if (sys[m.prov[i]] && !(Math.abs(d) <= PRICE_TOL)) { st.system++; status[i] = CheckStatus.System; continue; }
    if (e !== e) { st.noQuote++; status[i] = CheckStatus.NoQuote; continue; }
    if (d > PRICE_TOL) { st.over++; st.overAmt += d; status[i] = CheckStatus.Over; }
    else if (d < -PRICE_TOL) { st.under++; st.underAmt -= d; status[i] = CheckStatus.Under; }
    else { st.match++; status[i] = CheckStatus.Match; }
  }
  return { byCustomer: [...compiled.values()].map((c) => c.stat), status, expected };
}
