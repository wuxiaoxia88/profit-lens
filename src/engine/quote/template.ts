// 报价模板：报价 ⇄ 表格行。用户下载模板（由系统还原报价预填）→ 在 Excel 里修改 → 上传核对。
//
// 模板格式（每行一个分区，也可以每行一个省份）：
//   分区 | 省份 | ≤1.2 | 1.2–1.5 | … | 续重起点(kg) | 续重基价(元) | 续重单价(元/kg) | 续重取整
// 重量段列名里的最后一个数字视为该段上限，例如「1.2-1.5」「1.2<w≤1.5」「≤1.2」「1.5kg以内」。
import { bandLabels } from '../bands';
import type { Cell } from '../xlsxWriter';
import { normalizeProvince } from '../regions';
import type { PriceBasis } from '../model';
import { originOf, zoneName, type Quote, type QuoteZone, type Rounding } from './types';

const ROUND_TEXT: Record<Rounding, string> = { ceil: '向上取整', exact: '按实重', 'ceil0.5': '向上取整0.5' };

export const TEMPLATE_TAIL_HEADERS = ['续重起点(kg)', '续重基价(元)', '续重单价(元/kg)', '续重取整', '续重计重起点(kg)'];

export function quoteToRows(q: Quote): Cell[][] {
  const labels = bandLabels(q.breakpoints).slice(0, q.breakpoints.length);
  const header: Cell[] = ['分区', '省份（用顿号分隔）', ...labels, ...TEMPLATE_TAIL_HEADERS];
  const rows: Cell[][] = [header];
  for (const z of q.zones) {
    rows.push([
      z.name,
      z.provinces.join('、'),
      ...z.prices.map((p) => (p === null ? null : p)),
      z.tail ? z.tail.start : null,
      z.tail ? z.tail.base : null,
      z.tail ? z.tail.perKg : null,
      z.tail ? ROUND_TEXT[z.tail.rounding] : null,
      z.tail ? originOf(z.tail) : null,
    ]);
  }
  return rows;
}

export const TEMPLATE_GUIDE: Cell[][] = [
  ['报价模板填写说明'],
  ['1. 每行一个分区；同价的省份写在同一行，用顿号「、」分隔。也可以每行只写一个省份。'],
  ['2. 重量段列表示「上一列上限 < 重量 ≤ 本列上限」，单位 kg，填该段的单票运费（元，含面单费）。可以增删重量段列，列名写成「1.2-1.5」或「≤1.2」即可。'],
  ['3. 超过「续重起点」的单按续重计价：运费 = 续重基价 + 续重单价 × 取整(重量 − 续重计重起点)。计重起点不填则等于续重起点。'],
  ['   例：「3kg以上 = 面单款3元 + 单价 × 整公斤数（从0kg开始）」→ 续重起点 3、基价 3、计重起点 0；「2kg以上 = 首重4元 +（重量−1）× 单价」→ 续重起点 2、基价 4、计重起点 1。'],
  ['4. 续重取整可填：向上取整（按 1kg 进位）、向上取整0.5（按 0.5kg 进位）、按实重（不取整）。不需要续重的分区留空。'],
  ['5. 运费口径 = 面单收入 + 中转收入，不含退件、保价等增值费用。'],
  ['6. 填好后在「报价核对」页点击「上传报价」，系统会逐单比对应收与实收。'],
];

function upperOf(header: string): number | null {
  const nums = header.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const v = Number(nums[nums.length - 1]);
  return v > 0 ? v : null;
}

function parseRounding(s: string): Rounding {
  if (/实重|不取整|exact/i.test(s)) return 'exact';
  if (/0\.5|半/.test(s)) return 'ceil0.5';
  return 'ceil';
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.trim().replace(/[¥￥元,]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 从表格行解析报价；rows[0] 起寻找含「省份/目的地」的表头行 */
export function rowsToQuote(rows: string[][], name: string, basis: PriceBasis = 'sheet+transfer'): Quote {
  const hi = rows.findIndex((r) => r.some((c) => /省份|目的地|流向/.test(c ?? '')));
  if (hi < 0) throw new Error('没有找到表头：需要一列名为「省份」或「目的地」');
  const header = rows[hi].map((c) => (c ?? '').trim());
  const provCol = header.findIndex((c) => /省份|目的地|流向/.test(c));
  const zoneCol = header.findIndex((c, i) => i !== provCol && /分区|区域|名称/.test(c));
  const tailIdx = {
    start: header.findIndex((c) => /续重起点/.test(c) && !/计重/.test(c)),
    base: header.findIndex((c) => /续重基价|续重首价|基价/.test(c)),
    perKg: header.findIndex((c) => /续重单价|续重价/.test(c)),
    rounding: header.findIndex((c) => /取整|进位/.test(c)),
    origin: header.findIndex((c) => /计重起点/.test(c)),
  };
  const tailCols = new Set(Object.values(tailIdx).filter((i) => i >= 0));
  const bandCols: { col: number; upper: number }[] = [];
  header.forEach((c, i) => {
    if (i === provCol || i === zoneCol || tailCols.has(i) || !c) return;
    const u = upperOf(c);
    if (u !== null) bandCols.push({ col: i, upper: u });
  });
  if (!bandCols.length) throw new Error('没有找到重量段列：列名需要包含重量上限数字，例如「≤1.2」「1.2-1.5」');
  bandCols.sort((a, b) => a.upper - b.upper);
  const breakpoints = bandCols.map((b) => b.upper);

  const zones: QuoteZone[] = [];
  for (const r of rows.slice(hi + 1)) {
    const provText = (r[provCol] ?? '').trim();
    if (!provText) continue;
    const provinces = [...new Set(provText.split(/[、,，;；\s/]+/).filter(Boolean).map(normalizeProvince))];
    const prices = bandCols.map((b) => num(r[b.col]));
    const start = tailIdx.start >= 0 ? num(r[tailIdx.start]) : null;
    const base = tailIdx.base >= 0 ? num(r[tailIdx.base]) : null;
    const perKg = tailIdx.perKg >= 0 ? num(r[tailIdx.perKg]) : null;
    const tail =
      base !== null && perKg !== null
        ? {
            start: start ?? breakpoints[breakpoints.length - 1],
            base,
            perKg,
            rounding: parseRounding(tailIdx.rounding >= 0 ? r[tailIdx.rounding] ?? '' : ''),
            ...(tailIdx.origin >= 0 && num(r[tailIdx.origin]) !== null && num(r[tailIdx.origin]) !== (start ?? breakpoints[breakpoints.length - 1]) ? { origin: num(r[tailIdx.origin])! } : {}),
          }
        : null;
    zones.push({ id: `u${zones.length + 1}`, name: (zoneCol >= 0 ? r[zoneCol]?.trim() : '') || zoneName(zones.length), provinces, prices, tail });
  }
  if (!zones.length) throw new Error('报价表里没有任何省份行');
  // 同一省份出现在多行时，后面的覆盖前面的
  const seen = new Map<string, number>();
  zones.forEach((z, zi) => z.provinces.forEach((p) => seen.set(p, zi)));
  zones.forEach((z, zi) => (z.provinces = z.provinces.filter((p) => seen.get(p) === zi)));
  return { name, origin: 'uploaded', basis, breakpoints, zones: zones.filter((z) => z.provinces.length), createdAt: new Date().toISOString() };
}
