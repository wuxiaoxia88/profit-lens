// 重量段：用一组升序断点表示，区间为「左开右闭」：(0,b1]、(b1,b2]、…、(bn,∞)。
// 这与快递报价的惯例一致：1.2kg 属于「1.2kg 以内」。

export const DEFAULT_BREAKPOINTS = [0.5, 1, 2, 3, 5, 10];

export function fmtKg(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

export function bandLabels(bps: number[]): string[] {
  const labels: string[] = [];
  let prev = 0;
  for (const b of bps) {
    labels.push(prev === 0 ? `≤${fmtKg(b)}` : `${fmtKg(prev)}–${fmtKg(b)}`);
    prev = b;
  }
  labels.push(`>${fmtKg(prev)}`);
  return labels;
}

/** 重量 → 段序号（0..bps.length）。重量容差 1e-9，避免浮点误差把 1.2 判到下一段。 */
export function bandIndex(w: number, bps: number[]): number {
  for (let i = 0; i < bps.length; i++) if (w <= bps[i] + 1e-9) return i;
  return bps.length;
}

export function computeBands(weight: Float64Array, bps: number[]): Uint8Array {
  const out = new Uint8Array(weight.length);
  const n = bps.length;
  for (let i = 0; i < weight.length; i++) {
    const w = weight[i];
    let k = 0;
    while (k < n && w > bps[k] + 1e-9) k++;
    out[i] = k;
  }
  return out;
}

/** 解析用户输入的断点，例如 "0.5, 1, 1.2, 2" 或 "0.5 1 2" */
export function parseBreakpoints(text: string): number[] | null {
  const parts = text.split(/[,，、\s]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const uniq = [...new Set(parts.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  return uniq.length > 30 ? null : uniq;
}
