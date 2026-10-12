// 特殊区域分析：导出只有省份没有城市，但派费是按实际派送城市结算的。
// 同一省份里，若有一部分单的派费明显高于本省常见水平，说明省内存在高成本城市或偏远地区。
// 分析口径：0.3–1kg、非退件、派费 > 0 的单（排除重量和退件对派费的影响）。
import type { Model } from './model';

export interface AreaFinding {
  province: string;
  kind: 'tail' | 'level';
  text: string;
  /** 用于排序：受影响票量占比或差额 */
  weight: number;
}

/** 价格表里出现过的地市 → 所属省份（用于把报价单的「特殊区域」挂到省份上） */
export const CITY_TO_PROVINCE: Record<string, string> = {
  甘孜: '四川', 阿坝: '四川', 凉山: '四川',
  玉树: '青海', 果洛: '青海', 海西: '青海', 黄南: '青海',
  甘南: '甘肃', 迪庆: '云南', 怒江: '云南',
  舟山: '浙江', 嵊泗: '浙江', 岱山: '浙江',
  深圳: '广东', 广州: '广东', 东莞: '广东',
  长岛: '山东', 涠洲: '广西', 三沙: '海南', 长海: '辽宁',
  阿拉善: '内蒙古', 呼伦贝尔: '内蒙古', 大兴安岭: '黑龙江', 阿里: '西藏', 那曲: '西藏',
};

/** 已按偏远省份整体报价的地区：只看省内差异，不提示全省偏高 */
const REMOTE = new Set(['新疆', '西藏', '青海', '甘肃', '宁夏', '内蒙古', '海南']);

const MIN_N = 300;
const TAIL_DELTA = 0.25;
/** 高成本单至少占 1%，且摊到全省每票的额外派费 ≥ 0.015 元（占比小但贵得多的海岛也能识别） */
const TAIL_SHARE = 0.01;
const TAIL_IMPACT = 0.015;
const LEVEL_DELTA = 0.15;

function median(a: Float64Array): number {
  const s = Float64Array.from(a).sort();
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

export function analyzeDispatch(m: Model): AreaFinding[] {
  const w = m.cols.weight, pf = m.cols.cDispatch;
  if (!w || !pf) return [];
  const ret = m.data.dict.returned;
  const isRet = ret ? ret.values.map((v) => v.trim() === '是') : null;
  const P = m.provNames.length;
  const counts = new Int32Array(P);
  const ok = (i: number) => w[i] > 0.3 && w[i] <= 1 && pf[i] > 0 && !(isRet && isRet[ret!.codes[i]]);
  for (let i = 0; i < m.n; i++) if (ok(i)) counts[m.prov[i]]++;
  const vals = Array.from(counts, (c) => new Float64Array(c));
  const fill = new Int32Array(P);
  for (let i = 0; i < m.n; i++) if (ok(i)) { const p = m.prov[i]; vals[p][fill[p]++] = pf[i]; }

  const stats = vals.map((v, p) => {
    if (v.length < MIN_N) return null;
    const med = median(v);
    let hi = 0, hiSum = 0;
    for (const x of v) if (x > med + TAIL_DELTA) { hi++; hiSum += x; }
    return { p, n: v.length, med, share: hi / v.length, hiMean: hi ? hiSum / hi : NaN };
  });
  const meds = Float64Array.from(stats.filter((s) => s && !REMOTE.has(m.provNames[s.p])).map((s) => s!.med));
  const nat = median(meds);
  const out: AreaFinding[] = [];
  for (const s of stats) {
    if (!s) continue;
    const name = m.provNames[s.p];
    if (s.share >= TAIL_SHARE && s.share * (s.hiMean - s.med) >= TAIL_IMPACT) {
      out.push({
        province: name,
        kind: 'tail',
        weight: s.share * (s.hiMean - s.med),
        text: `约 ${(s.share * 100).toFixed(s.share < 0.05 ? 1 : 0)}% 的单派费明显高于本省常见水平（${s.med.toFixed(2)} → 约 ${s.hiMean.toFixed(2)} 元），省内有高成本城市或偏远地区`,
      });
    }
    if (!REMOTE.has(name) && s.med - nat >= LEVEL_DELTA) {
      out.push({ province: name, kind: 'level', weight: s.med - nat, text: `全省派费 ${s.med.toFixed(2)} 元，比各省常见水平（${nat.toFixed(2)}）高 ${(s.med - nat).toFixed(2)} 元` });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}
