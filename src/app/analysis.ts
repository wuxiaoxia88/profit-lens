// 页面共用的分组统计：把聚合结果变成带单票指标、纯利的行。
import { bandLabels } from '../engine/bands';
import { aggregate, combineKeys, opCostFor, type Agg, type OpCost } from '../engine/model';
import type { Derived } from './store';

export interface GroupRow {
  key: number;
  label: string;
  n: number;
  share: number;
  weight: number;
  avgW: number;
  income: number;
  cost: number;
  profit: number;
  lossN: number;
  unitIncome: number;
  unitCost: number;
  unitProfit: number;
  margin: number;
  opc: number;
  net: number;
  unitNet: number;
  price: number;
}

export function rowsOf(agg: Agg, labels: string[], totalN: number, op: OpCost): GroupRow[] {
  const out: GroupRow[] = [];
  for (let k = 0; k < agg.K; k++) {
    const n = agg.n[k];
    const g = (m: keyof Agg['sum']) => agg.sum[m]?.[k] ?? NaN;
    const income = g('income'), cost = g('cost'), profit = g('profit');
    const opc = opCostFor(op, n, totalN);
    out.push({
      key: k, label: labels[k] ?? String(k), n, share: totalN ? n / totalN : 0,
      weight: g('weight'), avgW: n ? g('weight') / n : NaN,
      income, cost, profit, lossN: agg.lossN[k],
      unitIncome: n ? income / n : NaN, unitCost: n ? cost / n : NaN, unitProfit: n ? profit / n : NaN,
      margin: income ? profit / income : NaN,
      opc, net: profit - opc, unitNet: n ? (profit - opc) / n : NaN,
      price: n ? g('price') / n : NaN,
    });
  }
  return out;
}

export function totalRow(d: Derived, op: OpCost): GroupRow {
  return rowsOf(aggregate(d.model, d.mask, null, 1), ['合计'], d.count, op)[0];
}

export function bandRows(d: Derived, op: OpCost): GroupRow[] {
  const labels = bandLabels(d.bands);
  return rowsOf(aggregate(d.model, d.mask, d.bandKey, labels.length), labels, d.count, op);
}

export function provRows(d: Derived, op: OpCost): GroupRow[] {
  return rowsOf(aggregate(d.model, d.mask, d.model.prov, d.model.provNames.length), d.model.provNames, d.count, op);
}

/** 省份 × 重量段矩阵：返回 [省][段] */
export function matrixRows(d: Derived, op: OpCost): GroupRow[][] {
  const B = d.bands.length + 1;
  const P = d.model.provNames.length;
  const key = combineKeys(d.model.prov, d.bandKey, B);
  const labels = bandLabels(d.bands);
  const rows = rowsOf(aggregate(d.model, d.mask, key, P * B), [], d.count, op);
  return Array.from({ length: P }, (_, p) => rows.slice(p * B, p * B + B).map((r, b) => ({ ...r, label: `${d.model.provNames[p]} ${labels[b]}` })));
}

export interface Insight {
  tone: 'pos' | 'neg' | 'info';
  text: string;
}

/** 自动结论：帮新手 10 秒抓住重点 */
export function insights(d: Derived, op: OpCost, total: GroupRow, bands: GroupRow[], provs: GroupRow[]): Insight[] {
  const out: Insight[] = [];
  const hasProfit = d.model.caps.profit;
  const opSet = op.perTicket > 0 || op.fixedTotal > 0;
  const metric = (r: GroupRow) => (opSet ? r.unitNet : r.unitProfit);
  const word = opSet ? '单票纯利' : '单票毛利';
  const validProv = provs.filter((p) => p.n >= Math.max(30, d.count * 0.002));
  const light = bands.filter((b) => b.n > 0);
  const top = [...bands].sort((a, b) => b.n - a.n)[0];
  if (top) out.push({ tone: 'info', text: `票量最集中的重量段是 ${top.label}kg，占 ${(top.share * 100).toFixed(1)}%。` });
  const topProv = [...provs].sort((a, b) => b.n - a.n).slice(0, 3);
  if (topProv.length) out.push({ tone: 'info', text: `前三大流向：${topProv.map((p) => `${p.label} ${(p.share * 100).toFixed(1)}%`).join('、')}，合计 ${(topProv.reduce((a, p) => a + p.share, 0) * 100).toFixed(1)}%。` });
  if (!hasProfit) return out;
  if (opSet) {
    out.push({ tone: total.net >= 0 ? 'pos' : 'neg', text: `扣除线下成本后，整体${total.net >= 0 ? '盈利' : '亏损'} ${Math.abs(total.net).toFixed(0)} 元，单票 ${total.unitNet.toFixed(3)} 元。` });
  } else {
    out.push({ tone: 'neg', text: '尚未设置线下操作管理成本，当前结论基于毛利，实际纯利会更低。' });
  }
  const lossBands = light.filter((b) => metric(b) < 0 && b.n >= 10);
  if (lossBands.length) {
    const lossSum = lossBands.reduce((a, b) => a + (opSet ? b.net : b.profit), 0);
    out.push({ tone: 'neg', text: `亏损重量段：${lossBands.map((b) => `${b.label}kg（${word} ${metric(b).toFixed(2)}）`).join('、')}，合计亏 ${Math.abs(lossSum).toFixed(0)} 元。` });
  }
  const lossProv = validProv.filter((p) => metric(p) < 0).sort((a, b) => (opSet ? a.net - b.net : a.profit - b.profit));
  if (lossProv.length) {
    out.push({ tone: 'neg', text: `亏损流向 ${lossProv.length} 个，亏得最多：${lossProv.slice(0, 4).map((p) => `${p.label}（${word} ${metric(p).toFixed(2)}，${p.n} 票）`).join('、')}。` });
  }
  const best = [...validProv].sort((a, b) => (opSet ? b.net - a.net : b.profit - a.profit)).slice(0, 3);
  if (best.length) out.push({ tone: 'pos', text: `利润贡献最大：${best.map((p) => `${p.label}（${(opSet ? p.net : p.profit).toFixed(0)} 元）`).join('、')}。` });
  if (total.lossN / Math.max(1, total.n) > 0.2) out.push({ tone: 'neg', text: `有 ${(total.lossN / total.n * 100).toFixed(1)}% 的单毛利为负，建议在「流向 × 重量利润」页定位并考虑调价。` });
  return out;
}
