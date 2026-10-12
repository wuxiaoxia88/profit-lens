// 把报价写成网点价格表的「版式一」，方便直接贴进价格表工作簿补全缺失客户：
//   城市 | 0-1.2kg | 1.21-1.5kg | … | 3kg以上面单款 | 3kg以上（0kg开始）
//   省份 | 1KG以内 | … | 1KG以上            ← 首重后直接续重的省份（新疆、西藏等）
// 北京、上海的加收已含在价格里，所以不写「加收」备注（否则再次导入会重复加）。
import { PROVINCES } from '../regions';
import type { Cell } from '../xlsxWriter';
import { originOf, type Quote, type TailRule } from './types';

const ORDER = ['浙江', '上海', '江苏', '安徽', '广东', '福建', '江西', '山东', '湖北', '河北', '北京', '河南', '天津', '湖南', '山西', '陕西', '重庆', '贵州', '辽宁', '广西', '云南', '四川', '吉林', '黑龙江', '海南', '甘肃', '内蒙古', '宁夏', '青海', '新疆', '西藏', '台湾', '香港', '澳门'];

const fmt = (v: number) => Math.round(v * 1000) / 1000;

function bandHeader(lower: number, upper: number): string {
  if (lower === 0) return `0-${fmt(upper)}kg`;
  return `${fmt(lower + 0.01)}-${fmt(upper)}kg`;
}

/** 续重改写成「面单款 + 单价 × 取整重量（0kg 开始）」；做不到时返回 null */
function asZeroOrigin(t: TailRule): { base: number; perKg: number } | null {
  if (t.rounding !== 'ceil' || t.steps?.length) return null;
  const o = originOf(t);
  if (Math.abs(o - Math.round(o)) > 1e-9) return null;
  return { base: fmt(t.base - t.perKg * o), perKg: t.perKg };
}

export interface SheetExportOptions {
  title: string;
  sheetFee?: number;
  note?: string;
}

export function quoteToSheetRows(q: Quote, opts: SheetExportOptions): { rows: Cell[][]; warnings: string[] } {
  const warnings: string[] = [];
  const bps = q.breakpoints;
  const last = bps[bps.length - 1];
  const header: Cell[] = ['城市', ...bps.map((b, i) => bandHeader(i === 0 ? 0 : bps[i - 1], b)), `${fmt(last)}kg以上面单款`, `${fmt(last)}kg以上（0kg开始）`];
  const rows: Cell[][] = [[opts.title], header];
  const zoneOf = new Map<string, Quote['zones'][number]>();
  for (const z of q.zones) for (const p of z.provinces) zoneOf.set(p, z);
  const order = [...ORDER, ...PROVINCES.map((p) => p.name).filter((p) => !ORDER.includes(p))];
  const sub: { p: string; first: number; upTo: number; perKg: number; exact: boolean }[] = [];
  for (const p of order) {
    const z = zoneOf.get(p);
    if (!z) continue;
    const t = z.tail;
    if (t && t.start < last - 1e-9) {
      // 首重后直接续重（如新疆、西藏首重 1kg）
      const first = z.prices[0];
      if (first === null || Math.abs(originOf(t) - t.start) > 1e-9 || Math.abs(t.base - first) > 0.005) {
        warnings.push(`${p}：续重规则无法用价格表版式表达，已跳过`);
        continue;
      }
      sub.push({ p, first, upTo: t.start, perKg: t.perKg, exact: t.rounding === 'exact' });
      continue;
    }
    if (t && z.stats?.tailLowConfidence) {
      warnings.push(`${p}：重货样本不足，续重列留空，请按实际补充`);
      rows.push([p, ...z.prices.map((v) => (v === null ? null : v)), null, null]);
      continue;
    }
    const z0 = t ? asZeroOrigin(t) : null;
    if (t && !z0) warnings.push(`${p}：续重为「${t.rounding === 'exact' ? '按实重' : '阶梯/0.5kg'}」，价格表版式无法表达，续重列留空`);
    rows.push([p, ...z.prices.map((v) => (v === null ? null : v)), z0 ? z0.base : null, z0 ? z0.perKg : null]);
  }
  // 小表只能有一个首重重量；首重不同的省份无法放进同一张小表
  const subOk = sub.filter((x) => Math.abs(x.upTo - (sub[0]?.upTo ?? 0)) < 1e-9);
  for (const x of sub) if (!subOk.includes(x)) warnings.push(`${x.p}：首重 ${x.upTo}kg 与其他省份不同，已跳过`);
  sub.length = 0;
  sub.push(...subOk);
  if (sub.length) {
    const upTo = sub[0].upTo;
    const blank = bps.length - 2;
    rows.push(['省份', `${fmt(upTo)}KG以内`, ...Array(Math.max(0, blank)).fill(null), `${fmt(upTo)}KG以上`]);
    for (const s of sub) rows.push([s.p, s.first, ...Array(Math.max(0, blank)).fill(null), s.perKg]);
  }
  if (opts.sheetFee !== undefined) rows.push([`单号先付${opts.sheetFee}元/单`]);
  rows.push(['北京、上海价格已含加收，无需另加。']);
  rows.push([`${fmt(last)}kg以上：面单款+重量取整*单价（从0kg开始，超出部分向上取整）。`]);
  if (sub.some((s) => s.exact)) rows.push([`${sub.filter((s) => s.exact).map((s) => s.p).join('、')}${fmt(sub[0].upTo)}kg以上按实际重量计算续重（不取整）。`]);
  if (opts.note) rows.push([opts.note]);
  return { rows, warnings };
}
