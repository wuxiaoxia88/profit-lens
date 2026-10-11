// 数字格式化：金额、单票、百分比、票数。
export const fmtInt = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('zh-CN') : '—');

/** 金额：≥1 万显示「x.xx万」 */
export function fmtMoney(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(digits);
}

/** 单票金额：3 位小数 */
export const fmtUnit = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '—');
export const fmtPrice = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v * 100) / 100));
export const fmtPct = (v: number, digits = 1) => (Number.isFinite(v) ? (v * 100).toFixed(digits) + '%' : '—');
export const fmtKg = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
export const signed = (s: string, v: number) => (v > 0 ? '+' + s : s);
