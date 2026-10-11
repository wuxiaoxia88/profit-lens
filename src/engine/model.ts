// 分析模型：在原始列之上派生出省份、运费单价、收入/成本/利润等列，并提供筛选与分组聚合。
import { NO_DATE, type DatasetData } from './dataset';
import { capabilitiesOf, type Capabilities, type DictField, type FieldId, type NumField } from './schema';
import { normalizeProvince, provinceOrder } from './regions';

export const MEASURES = [
  'weight', 'income', 'cost', 'profit', 'price',
  'inTransfer', 'inSheet', 'inVA',
  'cTransfer', 'cDispatch', 'cSheet', 'cVA', 'cPolicy',
] as const;
export type Measure = (typeof MEASURES)[number];

export type PriceBasis = 'sheet+transfer' | 'income-va' | 'income';

export interface Model {
  data: DatasetData;
  n: number;
  caps: Capabilities;
  fields: Set<FieldId>;
  /** 省份序号（provNames 下标），按地理顺序排好 */
  prov: Int32Array;
  provNames: string[];
  /** 派生度量列（不存在的为 undefined） */
  cols: Partial<Record<Measure, Float64Array>>;
  priceBasis: PriceBasis;
  day: Int32Array | null;
  minDay: number;
  maxDay: number;
}

function addArrays(...arrs: (Float64Array | undefined)[]): Float64Array | undefined {
  const xs = arrs.filter(Boolean) as Float64Array[];
  if (!xs.length) return undefined;
  const out = new Float64Array(xs[0].length);
  for (const a of xs) for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) out[i] += v; }
  return out;
}

export function buildModel(data: DatasetData): Model {
  const fields = new Set(data.fields);
  const caps = capabilitiesOf(fields);
  const n = data.n;
  const num = data.num;

  // 省份：字典值先标准化，再按地理顺序重新编号
  const prov = new Int32Array(n);
  let provNames: string[] = [];
  const dest = data.dict.dest;
  if (dest) {
    const normed = dest.values.map(normalizeProvince);
    // 只保留实际出现过的值（字典里总有一个空串占位）
    const used = new Uint8Array(dest.values.length);
    for (let i = 0; i < n; i++) used[dest.codes[i]] = 1;
    provNames = [...new Set(normed.filter((_, c) => used[c]))].sort((a, b) => provinceOrder(a) - provinceOrder(b) || a.localeCompare(b, 'zh'));
    const idx = new Map(provNames.map((p, i) => [p, i]));
    const remap = Int32Array.from(normed, (p) => idx.get(p) ?? 0);
    for (let i = 0; i < n; i++) prov[i] = remap[dest.codes[i]];
  }

  const cols: Model['cols'] = {};
  const copy = (k: NumField) => num[k];
  cols.weight = copy('weight');
  cols.inTransfer = copy('inTransfer');
  cols.inSheet = copy('inSheet');
  cols.inVA = copy('inVA');
  cols.cTransfer = copy('cTransfer');
  cols.cDispatch = copy('cDispatch');
  cols.cSheet = copy('cSheet');
  cols.cVA = copy('cVA');
  cols.cPolicy = copy('cPolicy');
  cols.income = num.income ?? addArrays(num.inTransfer, num.inSheet, num.inVA);
  cols.cost = num.cost ?? addArrays(num.cTransfer, num.cDispatch, num.cSheet, num.cVA, num.cPolicy);
  if (num.profit) cols.profit = num.profit;
  else if (cols.income && cols.cost) {
    const p = new Float64Array(n);
    const a = cols.income, b = cols.cost;
    for (let i = 0; i < n; i++) p[i] = (a[i] || 0) - (b[i] || 0);
    cols.profit = p;
  }

  // 运费单价口径：优先「面单收入 + 中转收入」，其次「收入 − 增值收入」，最后「收入」
  let priceBasis: PriceBasis = 'income';
  if (num.inSheet || num.inTransfer) {
    cols.price = addArrays(num.inSheet, num.inTransfer);
    priceBasis = 'sheet+transfer';
  } else if (cols.income && num.inVA) {
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) p[i] = (cols.income[i] || 0) - (num.inVA[i] || 0);
    cols.price = p;
    priceBasis = 'income-va';
  } else if (cols.income) {
    cols.price = cols.income;
  }

  const day = data.dates.date ?? null;
  let minDay = Infinity, maxDay = -Infinity;
  if (day) for (let i = 0; i < n; i++) { const d = day[i]; if (d !== NO_DATE) { if (d < minDay) minDay = d; if (d > maxDay) maxDay = d; } }

  return { data, n, caps, fields, prov, provNames, cols, priceBasis, day, minDay, maxDay };
}

// ───────────────────────── 筛选 ─────────────────────────

export type TriState = 'all' | 'yes' | 'no';

export interface Filters {
  dateFrom: number | null;
  dateTo: number | null;
  /** 字典编码集合；null 表示不过滤 */
  accounts: Set<number> | null;
  customers: Set<number> | null;
  signStatus: Set<number> | null;
  provinces: Set<number> | null;
  returned: TriState;
  selfSign: TriState;
  shipped: TriState;
  /** 剔除重量为 0 或运费为 0 的异常单 */
  excludeAbnormal: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  dateFrom: null, dateTo: null, accounts: null, customers: null, signStatus: null, provinces: null,
  returned: 'all', selfSign: 'all', shipped: 'all', excludeAbnormal: false,
};

/** 判断字典值是否表示「是」 */
function yesCodes(values: string[]): Uint8Array {
  return Uint8Array.from(values, (v) => (/^(是|y|yes|true|1|已发货|已发)$/i.test(v.trim()) ? 1 : 0));
}

export function applyFilters(m: Model, f: Filters): { mask: Uint8Array; count: number } {
  const n = m.n;
  const mask = new Uint8Array(n).fill(1);
  const d = m.data.dict;
  const dictFilter = (field: DictField, set: Set<number> | null) => {
    const col = d[field];
    if (!col || !set) return;
    const ok = new Uint8Array(col.values.length);
    for (const c of set) ok[c] = 1;
    const codes = col.codes;
    for (let i = 0; i < n; i++) if (!ok[codes[i]]) mask[i] = 0;
  };
  const triFilter = (field: DictField, t: TriState) => {
    const col = d[field];
    if (!col || t === 'all') return;
    const yes = yesCodes(col.values);
    const want = t === 'yes' ? 1 : 0;
    const codes = col.codes;
    for (let i = 0; i < n; i++) if (yes[codes[i]] !== want) mask[i] = 0;
  };
  dictFilter('account', f.accounts);
  dictFilter('customer', f.customers);
  dictFilter('signStatus', f.signStatus);
  triFilter('returned', f.returned);
  triFilter('selfSign', f.selfSign);
  triFilter('shipped', f.shipped);
  if (f.provinces) {
    const ok = new Uint8Array(m.provNames.length);
    for (const c of f.provinces) ok[c] = 1;
    for (let i = 0; i < n; i++) if (!ok[m.prov[i]]) mask[i] = 0;
  }
  if (m.day && (f.dateFrom !== null || f.dateTo !== null)) {
    const lo = f.dateFrom ?? -Infinity, hi = f.dateTo ?? Infinity;
    const day = m.day;
    for (let i = 0; i < n; i++) { const v = day[i]; if (v === NO_DATE || v < lo || v > hi) mask[i] = 0; }
  }
  if (f.excludeAbnormal) {
    const w = m.cols.weight, p = m.cols.price;
    for (let i = 0; i < n; i++) if ((w && !(w[i] > 0)) || (p && !(p[i] > 0))) mask[i] = 0;
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += mask[i];
  return { mask, count };
}

// ───────────────────────── 聚合 ─────────────────────────

export interface Agg {
  K: number;
  n: Float64Array;
  /** 亏损票数（利润 < 0） */
  lossN: Float64Array;
  sum: Partial<Record<Measure, Float64Array>>;
}

/**
 * 按整数键分组求和。key 为 null 时整体汇总（K=1）。
 * 一次遍历计算所有可用度量。
 */
export function aggregate(m: Model, mask: Uint8Array, key: ArrayLike<number> | null, K: number): Agg {
  const kk = key ? K : 1;
  const nArr = new Float64Array(kk);
  const lossN = new Float64Array(kk);
  const present = MEASURES.filter((x) => m.cols[x]);
  const src = present.map((x) => m.cols[x]!);
  const dst = present.map(() => new Float64Array(kk));
  const profit = m.cols.profit;
  const len = m.n;
  const M = present.length;
  for (let i = 0; i < len; i++) {
    if (!mask[i]) continue;
    const g = key ? key[i] : 0;
    if (g < 0 || g >= kk) continue;
    nArr[g]++;
    for (let j = 0; j < M; j++) { const v = src[j][i]; if (v === v) dst[j][g] += v; }
    if (profit && profit[i] < 0) lossN[g]++;
  }
  const sum: Agg['sum'] = {};
  present.forEach((x, j) => (sum[x] = dst[j]));
  return { K: kk, n: nArr, lossN, sum };
}

/** 两个键组合成一个：k = a * Kb + b */
export function combineKeys(a: ArrayLike<number>, b: ArrayLike<number>, Kb: number): Int32Array {
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * Kb + b[i];
  return out;
}

/** 重量直方图键：按 step（kg）分箱，超过 maxW 的进最后一箱 */
export function weightBinKey(m: Model, step: number, maxW: number): { key: Int32Array; K: number } {
  const w = m.cols.weight!;
  const K = Math.ceil(maxW / step) + 1;
  const key = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const v = w[i];
    // 左开右闭：0.1 属于 (0,0.1]
    let b = v > 0 ? Math.ceil(v / step - 1e-9) - 1 : 0;
    if (b < 0) b = 0;
    if (b >= K - 1) b = K - 1;
    key[i] = b;
  }
  return { key, K };
}

export function dayKey(m: Model): { key: Int32Array; K: number } | null {
  if (!m.day || !Number.isFinite(m.minDay)) return null;
  const K = m.maxDay - m.minDay + 1;
  const key = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) { const d = m.day[i]; key[i] = d === NO_DATE ? -1 : d - m.minDay; }
  return { key, K };
}

/** 线下操作管理成本设置 */
export interface OpCost {
  perTicket: number;
  fixedTotal: number;
}

/** 某组的线下成本：元/票 × 票数 + 固定总额按票数分摊 */
export function opCostFor(op: OpCost, groupN: number, totalN: number): number {
  return op.perTicket * groupN + (totalN > 0 ? (op.fixedTotal * groupN) / totalN : 0);
}

export function quantileWeight(m: Model, mask: Uint8Array, qs: number[]): number[] {
  const w = m.cols.weight;
  if (!w) return qs.map(() => NaN);
  // 0.01kg 计数排序，百万行也是线性时间
  const maxBin = 100000; // 1000kg
  const counts = new Uint32Array(maxBin + 1);
  let total = 0;
  for (let i = 0; i < m.n; i++) {
    if (!mask[i]) continue;
    const v = w[i];
    if (!(v >= 0)) continue;
    counts[Math.min(maxBin, Math.round(v * 100))]++;
    total++;
  }
  return qs.map((q) => {
    const target = q * total;
    let acc = 0;
    for (let b = 0; b <= maxBin; b++) { acc += counts[b]; if (acc >= target) return b / 100; }
    return maxBin / 100;
  });
}
