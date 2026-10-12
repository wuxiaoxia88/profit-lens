// 报价还原：从逐单「重量 → 运费」反推出 分区 × 重量段 价格表 + 续重公式。
// 算法说明见 docs/PLAN.md §5.2，口径说明见 docs/使用手册.md。
import type { Model } from '../model';
import { checkQuote } from './check';
import { PRICE_TOL, gOf, round2, sameTail, zoneName, type Quote, type QuoteZone, type Rounding, type TailRule } from './types';

/** 加权样本：同一重量、同一价格的多单合并 */
interface Pt { w: number; p: number; c: number }

interface ProvData {
  idx: number;
  name: string;
  tickets: number;
  pts: Pt[]; // 按重量升序
  minW: number;
  maxW: number;
}

export interface InferOptions {
  /** 断点需被多少比例的「两侧都有数据的省份」支持 */
  minSupportRatio?: number;
  /** 只用这些行（行号列表）推断；给了它就不再遍历全表，用于多客户批量推断 */
  rows?: Int32Array;
  /** 是否回填各分区覆盖统计（需要遍历全表，批量推断时关闭） */
  stats?: boolean;
}

/** 遍历参与推断的行：给了行号列表就只走列表，否则按掩码走全表 */
function eachRow(m: Model, mask: Uint8Array, rows: Int32Array | undefined, fn: (i: number) => void) {
  if (rows) { for (let k = 0; k < rows.length; k++) { const i = rows[k]; if (mask[i]) fn(i); } return; }
  for (let i = 0; i < m.n; i++) if (mask[i]) fn(i);
}

export interface InferResult {
  quote: Quote;
  coverage: number;
  notes: string[];
}

// 报价单的重量分界都是 0.1kg 的整数倍（1.2、1.5、0.3…），不会出现 1.47 这样的值
const NICE_STEPS = [1, 0.5, 0.1];

function nicest(lo: number, hi: number): number {
  for (const step of NICE_STEPS) {
    const c = Math.round(Math.ceil(lo / step - 1e-9) * step * 100) / 100;
    if (c >= lo - 1e-9 && c < hi - 1e-9) return c;
  }
  return lo;
}


function collect(m: Model, mask: Uint8Array, rows?: Int32Array): ProvData[] {
  const w = m.cols.weight!, price = m.cols.price!;
  const maps = m.provNames.map(() => new Map<number, number>());
  const tickets = new Float64Array(m.provNames.length);
  // 超 1kg 却没有中转收入（只收了面单费）的单，多半是中转费未入账或另行汇总计费。
  // 若某省大多数超 1kg 的单都有中转收入，这些单就不参与推断（核对时仍会作为例外列出）。
  const tr = m.cols.inTransfer;
  const skipZero = new Uint8Array(m.provNames.length);
  if (tr) {
    const heavy = new Float64Array(m.provNames.length), zero = new Float64Array(m.provNames.length);
    eachRow(m, mask, rows, (i) => {
      if (!(w[i] > 1) || !(price[i] > 0)) return;
      heavy[m.prov[i]]++;
      if (!(tr[i] > 0)) zero[m.prov[i]]++;
    });
    for (let p = 0; p < heavy.length; p++) skipZero[p] = heavy[p] && zero[p] / heavy[p] < 0.5 ? 1 : 0;
  }
  eachRow(m, mask, rows, (i) => {
    const wi = w[i], pi = price[i];
    if (!(wi > 0) || !(pi > 0)) return;
    if (tr && wi > 1 && skipZero[m.prov[i]] && !(tr[i] > 0)) return;
    const w100 = Math.min(99999, Math.round(wi * 100));
    const p100 = Math.round(pi * 100);
    const key = w100 * 1e7 + p100;
    const mp = maps[m.prov[i]];
    mp.set(key, (mp.get(key) ?? 0) + 1);
    tickets[m.prov[i]]++;
  });
  const out: ProvData[] = [];
  maps.forEach((mp, idx) => {
    if (!mp.size) return;
    const pts: Pt[] = [];
    for (const [key, c] of mp) pts.push({ w: Math.floor(key / 1e7) / 100, p: (key % 1e7) / 100, c });
    pts.sort((a, b) => a.w - b.w || a.p - b.p);
    out.push({ idx, name: m.provNames[idx], tickets: tickets[idx], pts, minW: pts[0].w, maxW: pts[pts.length - 1].w });
  });
  return out;
}

/** 每个重量取众数价格 */
function modalByWeight(pts: Pt[]): { w: number; p: number; c: number }[] {
  const out: { w: number; p: number; c: number }[] = [];
  let i = 0;
  while (i < pts.length) {
    let j = i, best = pts[i], total = 0;
    while (j < pts.length && pts[j].w === pts[i].w) { total += pts[j].c; if (pts[j].c > best.c) best = pts[j]; j++; }
    out.push({ w: pts[i].w, p: best.p, c: total });
    i = j;
  }
  return out;
}

interface Run { p: number; w0: number; w1: number; c: number }

function runsOf(pts: Pt[]): Run[] {
  const runs: Run[] = [];
  for (const x of modalByWeight(pts)) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.p - x.p) < PRICE_TOL) { last.w1 = x.w; last.c += x.c; }
    else runs.push({ p: x.p, w0: x.w, w1: x.w, c: x.c });
  }
  // 平滑：夹在两段同价之间、票量很小的段视为异常单
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = 1; k < runs.length - 1; k++) {
      const a = runs[k - 1], b = runs[k], c = runs[k + 1];
      if (Math.abs(a.p - c.p) < PRICE_TOL && b.c * 4 <= Math.min(a.c, c.c)) {
        a.w1 = c.w1; a.c += b.c + c.c;
        runs.splice(k, 2);
        changed = true;
        break;
      }
    }
  }
  return runs;
}

// ───────────────────────── 续重拟合 ─────────────────────────

interface TailFit { rule: TailRule; matched: number; total: number; lowConfidence: boolean }

const ROUNDINGS: Rounding[] = ['ceil', 'exact', 'ceil0.5'];

function fitTail(pts: Pt[], s: number, preferredK?: number, roundings: Rounding[] = ROUNDINGS): TailFit | null {
  const above = pts.filter((x) => x.w > s + 1e-9);
  const total = above.reduce((a, x) => a + x.c, 0);
  if (!total) return null;
  let best: TailFit | null = null;
  for (const r of roundings) {
    // 每个 g 取众数价格
    const byG = new Map<number, Map<number, number>>();
    for (const x of above) {
      const g = Math.round(gOf(x.w - s, r) * 1e6) / 1e6;
      const mp = byG.get(g) ?? new Map<number, number>();
      mp.set(x.p, (mp.get(x.p) ?? 0) + x.c);
      byG.set(g, mp);
    }
    const gs = [...byG.entries()].map(([g, mp]) => {
      let bp = 0, bc = -1, tc = 0;
      for (const [p, c] of mp) { tc += c; if (c > bc) { bc = c; bp = p; } }
      return { g, p: bp, c: tc };
    }).sort((a, b) => a.g - b.g);
    const kVotes = new Map<number, number>();
    const vote = (a: typeof gs[0], b: typeof gs[0]) => {
      const k = Math.round(((b.p - a.p) / (b.g - a.g)) * 100) / 100;
      if (k >= 0 && Number.isFinite(k)) kVotes.set(k, (kVotes.get(k) ?? 0) + Math.min(a.c, b.c));
    };
    for (let i = 1; i < gs.length; i++) { vote(gs[i - 1], gs[i]); if (i > 1) vote(gs[0], gs[i]); }
    let lowConfidence = false;
    if (!kVotes.size) {
      // 只有一个续重档位，单价无法确定：用给定单价（或暂用 0），标记低置信
      kVotes.set(preferredK ?? 0, 1);
      lowConfidence = true;
    }
    const cands = [...kVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
    for (const k of cands) {
      const baseVotes = new Map<number, number>();
      for (const x of above) {
        const b = round2(x.p - k * gOf(x.w - s, r));
        baseVotes.set(b, (baseVotes.get(b) ?? 0) + x.c);
      }
      let base = 0, bc = -1;
      for (const [b, c] of baseVotes) if (c > bc) { bc = c; base = b; }
      if (base < 0 || k > 100) continue; // 不合理的公式（负基价、天价续重）直接放弃
      let matched = 0;
      for (const x of above) if (Math.abs(round2(base + k * gOf(x.w - s, r)) - x.p) <= PRICE_TOL) matched += x.c;
      // 续重单价为 0（重货都同价）说明样本不足以判断单价，按低置信处理
      const low = lowConfidence || k === 0;
      if (!best || matched > best.matched || (matched === best.matched && best.lowConfidence && !low)) {
        best = { rule: { start: s, base, perKg: k, rounding: r }, matched, total, lowConfidence: low };
      }
    }
  }
  return best;
}

// ───────────────────────── 主流程 ─────────────────────────

function selectBreakpoints(provs: ProvData[], ratio: number): number[] {
  interface Iv { prov: number; lo: number; hi: number; used: boolean }
  const ivs: Iv[] = [];
  provs.forEach((pd, pi) => {
    const runs = runsOf(pd.pts);
    for (let k = 1; k < runs.length; k++) ivs.push({ prov: pi, lo: runs[k - 1].w1, hi: runs[k].w0, used: false });
  });
  // 从轻到重依次判断：重货区每公斤一个台阶，若按支持度贪心会抢走真正的段边界
  const isNice = (c: number) => Math.abs(c * 10 - Math.round(c * 10)) < 1e-6;
  const cands = [...new Set(ivs.map((iv) => nicest(iv.lo, iv.hi)))].filter(isNice).sort((a, b) => a - b);
  const chosen: number[] = [];
  const minAbs = Math.min(2, provs.length);
  for (const c of cands) {
    const sup = new Set<number>();
    for (const iv of ivs) if (!iv.used && iv.lo <= c + 1e-9 && c < iv.hi - 1e-9) sup.add(iv.prov);
    if (sup.size < minAbs) continue;
    const eligible = provs.filter((pd) => pd.minW <= c + 1e-9 && pd.maxW > c + 1e-9).length;
    if (sup.size < ratio * eligible) continue;
    chosen.push(c);
    for (const iv of ivs) if (iv.lo <= c + 1e-9 && c < iv.hi - 1e-9) iv.used = true;
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * 若从某个断点开始，往上的价格都能被「按公斤」续重公式解释，就把更高的断点并入续重。
 * 只认至少有 3 个不同续重档位的省份作为证据（两个点总能连成一条线），
 * 且只考虑 1kg 取整和按实重 —— 0.5kg 取整会把「1.5–2、2–3」这类正常段误判成续重。
 */
function truncateToTail(provs: ProvData[], bps: number[]): number[] {
  const strict: Rounding[] = ['ceil', 'exact'];
  for (let k = 0; k < bps.length - 1; k++) {
    const s = bps[k];
    let total = 0, matched = 0;
    for (const pd of provs) {
      const above = pd.pts.filter((x) => x.w > s + 1e-9);
      if (new Set(above.map((x) => Math.ceil(x.w - s - 1e-9))).size < 3) continue;
      const f = fitTail(pd.pts, s, undefined, strict);
      if (f) { total += f.total; matched += f.matched; }
    }
    if (total > 0 && matched / total >= 0.95) return bps.slice(0, k + 1);
    // 3kg 以上没有足够证据支撑固定重量段、且票量很少时，按网点惯例改为续重计价
    if (total === 0 && s >= 3 - 1e-9) {
      let above = 0, all = 0;
      for (const pd of provs) for (const x of pd.pts) { all += x.c; if (x.w > s + 1e-9) above += x.c; }
      if (above < all * 0.01) return bps.slice(0, k + 1);
    }
  }
  return bps;
}

interface BandMode { p: number | null; c: number; total: number }

function bandModes(pts: Pt[], bps: number[], upTo = Infinity): BandMode[] {
  const maps = bps.map(() => new Map<number, number>());
  const totals = bps.map(() => 0);
  for (const x of pts) {
    if (x.w > upTo + 1e-9) continue;
    let b = 0;
    while (b < bps.length && x.w > bps[b] + 1e-9) b++;
    if (b >= bps.length) continue;
    maps[b].set(x.p, (maps[b].get(x.p) ?? 0) + x.c);
    totals[b] += x.c;
  }
  return maps.map((mp, b) => {
    let p: number | null = null, c = 0;
    for (const [pp, cc] of mp) if (cc > c) { c = cc; p = pp; }
    return { p, c, total: totals[b] };
  });
}

interface ProvModel {
  pd: ProvData;
  prices: (number | null)[];
  /** 各段的票数：票数很少的段在分区聚类时不作为区分依据 */
  support: number[];
  earlyTail: TailRule | null;
  matched: number;
}

function provinceModel(pd: ProvData, bps: number[]): ProvModel {
  const last = bps[bps.length - 1];
  const modes = bandModes(pd.pts, bps);
  const tailFit = fitTail(pd.pts, last);
  const baseline = modes.reduce((a, m) => a + m.c, 0) + (tailFit?.matched ?? 0);
  const support = modes.map((m) => m.total);
  const result: ProvModel = { pd, prices: modes.map((m) => m.p), support, earlyTail: null, matched: baseline };
  if (baseline >= pd.tickets || pd.tickets < 2) return result;

  // 覆盖率偏低：尝试更早开始续重（如新疆/西藏：首重 1kg + 按实重续重）
  const starts = [...new Set([0.5, 1, 1.5, 2, 2.5, 3, ...bps])].filter((s) => s < last && s < pd.maxW).sort((a, b) => a - b);
  let best: { s: number; matched: number; continuity: boolean; fit: TailFit; modes: BandMode[] } | null = null;
  for (const s of starts) {
    const md = bandModes(pd.pts, bps, s);
    const fit = fitTail(pd.pts, s);
    if (!fit) continue;
    const matched = md.reduce((a, m) => a + m.c, 0) + fit.matched;
    let bi = 0;
    while (bi < bps.length && s > bps[bi] + 1e-9) bi++;
    const prev = md[bi]?.p ?? md[bi - 1]?.p ?? null;
    const continuity = prev !== null && Math.abs(prev - fit.rule.base) < PRICE_TOL;
    if (
      !best ||
      matched > best.matched ||
      (matched === best.matched && continuity && !best.continuity) ||
      (matched === best.matched && continuity === best.continuity && s > best.s)
    ) best = { s, matched, continuity, fit, modes: md };
  }
  if (best && best.matched - baseline >= Math.max(1, 0.01 * pd.tickets)) {
    const s = best.s;
    // s 以上的整段不再单独报价
    const prices = best.modes.map((m, b) => ((b === 0 ? 0 : bps[b - 1]) >= s - 1e-9 ? null : m.p));
    return { pd, prices, support, earlyTail: best.fit.rule, matched: best.matched };
  }
  return result;
}

function compatible(a: (number | null)[], b: (number | null)[]): boolean {
  let overlap = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    if (Math.abs(a[i]! - b[i]!) > PRICE_TOL) return false;
    overlap++;
  }
  return overlap > 0;
}

export function inferQuote(m: Model, mask: Uint8Array, opts: InferOptions = {}): InferResult {
  const notes: string[] = [];
  if (!m.cols.price || !m.cols.weight) throw new Error('缺少运费或重量字段，无法还原报价');
  const provs = collect(m, mask, opts.rows);
  if (!provs.length) throw new Error('筛选范围内没有有效运单（重量和运费都需大于 0）');

  let bps = selectBreakpoints(provs, opts.minSupportRatio ?? 0.3);
  if (bps.length > 1) bps = truncateToTail(provs, bps);
  // 最上面的重量段若几乎没有单（少于 8 单），并入续重区间，避免用一两单定出整段价格
  while (bps.length > 1) {
    const lo = bps[bps.length - 2], hi = bps[bps.length - 1];
    let c = 0;
    for (const pd of provs) for (const x of pd.pts) if (x.w > lo + 1e-9 && x.w <= hi + 1e-9) c += x.c;
    if (c >= 8) break;
    bps = bps.slice(0, -1);
  }
  if (!bps.length) {
    const maxW = Math.max(...provs.map((p) => p.maxW));
    bps = [Math.max(1, Math.ceil(maxW))];
    notes.push('未发现明显的重量段断点，按「一口价」处理。');
  }
  const last = bps[bps.length - 1];

  // 各省模型 → 聚类成分区
  const pms = provs.map((pd) => provinceModel(pd, bps)).sort((a, b) => b.pd.tickets - a.pd.tickets);
  interface ZoneAcc { members: ProvModel[]; prices: (number | null)[]; earlyTail: TailRule | null }
  const zones: ZoneAcc[] = [];
  // 第一遍：严格聚类（所有有价格的段都相同才算同一分区）
  for (const pm of pms) {
    const z = zones.find((z) => sameTail(z.earlyTail, pm.earlyTail) && compatible(z.prices, pm.prices));
    if (z) {
      z.members.push(pm);
      pm.prices.forEach((p, i) => { if (z.prices[i] === null) z.prices[i] = p; });
    } else {
      zones.push({ members: [pm], prices: [...pm.prices], earlyTail: pm.earlyTail });
    }
  }
  // 第二遍：小分区若只在「本分区合计不足 3 单」的段上与大分区不同，视为个别异常单，并入大分区
  const MIN_BAND = 3;
  const supportOf = (z: ZoneAcc) => z.prices.map((_, i) => z.members.reduce((a, pm) => a + pm.support[i], 0));
  const ticketsOfZone = (z: ZoneAcc) => z.members.reduce((a, pm) => a + pm.pd.tickets, 0);
  for (let changed = true; changed; ) {
    changed = false;
    const order = [...zones].sort((a, b) => ticketsOfZone(a) - ticketsOfZone(b));
    for (const small of order) {
      const sup = supportOf(small);
      const target = zones
        .filter((z) => z !== small && ticketsOfZone(z) > ticketsOfZone(small) && sameTail(z.earlyTail, small.earlyTail))
        .find((z) => {
          let agree = 0;
          for (let i = 0; i < z.prices.length; i++) {
            const a = small.prices[i], c = z.prices[i];
            if (a === null || c === null) continue;
            if (Math.abs(a - c) <= PRICE_TOL) agree++;
            else if (sup[i] >= MIN_BAND) return false;
          }
          return agree > 0;
        });
      if (target) {
        target.members.push(...small.members);
        zones.splice(zones.indexOf(small), 1);
        changed = true;
        break;
      }
    }
  }

  // 续重：同区合并样本拟合；若一条公式解释不了，就按公式拆分子区
  const allK: number[] = [];
  const out: { zone: QuoteZone; tickets: number }[] = [];
  const pending: { acc: ZoneAcc; groups: { fit: TailFit; members: ProvModel[] }[]; rest: ProvModel[] }[] = [];
  for (const z of zones) {
    if (z.earlyTail) { pending.push({ acc: z, groups: [], rest: z.members }); continue; }
    let left = z.members.filter((pm) => pm.pd.maxW > last + 1e-9);
    const rest = z.members.filter((pm) => !(pm.pd.maxW > last + 1e-9));
    const groups: { fit: TailFit; members: ProvModel[] }[] = [];
    while (left.length) {
      const pool = left.flatMap((pm) => pm.pd.pts);
      let fit = fitTail(pool, last)!;
      // 某省 ≥90% 的重货样本符合公式，就归入该组
      const matchesAll = (pm: ProvModel) => {
        const f = fitTailWith(pm.pd.pts, fit.rule);
        return f.matched >= Math.max(1, Math.floor(0.9 * f.total));
      };
      let members = left.filter(matchesAll);
      if (!members.length) {
        const biggest = left.reduce((a, b) => (b.pd.tickets > a.pd.tickets ? b : a));
        fit = fitTail(biggest.pd.pts, last) ?? fit;
        members = [biggest, ...left.filter((pm) => pm !== biggest && matchesAll(pm))];
      }
      groups.push({ fit, members });
      if (!fit.lowConfidence && fit.matched > 1) allK.push(fit.rule.perKg);
      left = left.filter((pm) => !members.includes(pm));
    }
    // 续重样本少于 3 单的分组不单独成区：并回第一组（最大样本组），标为低置信
    if (groups.length > 1) {
      const sizeOf = (g: { fit: TailFit }) => g.fit.total;
      const keep = groups.filter((g, k) => k === 0 || sizeOf(g) >= 3);
      const dropped = groups.filter((g) => !keep.includes(g));
      if (dropped.length) {
        keep[0].members.push(...dropped.flatMap((g) => g.members));
        if (keep.length === 1) keep[0].fit = { ...keep[0].fit, lowConfidence: keep[0].fit.lowConfidence || keep[0].fit.total < 3 };
      }
      groups.splice(0, groups.length, ...keep);
    }
    pending.push({ acc: z, groups, rest });
  }

  // 样本太少（只有一个重量）的续重：借用最常见的续重单价
  const commonK = mode(allK);
  for (const pz of pending) {
    for (const g of pz.groups) {
      if (g.fit.lowConfidence || g.fit.matched <= 1) {
        const pool = g.members.flatMap((pm) => pm.pd.pts);
        const distinctG = new Set(pool.filter((x) => x.w > last).map((x) => Math.ceil(x.w - last - 1e-9))).size;
        if (distinctG <= 1 && commonK !== undefined) {
          const refit = fitTail(pool, last, commonK);
          if (refit) { g.fit = { ...refit, lowConfidence: true }; }
        }
      }
    }
  }

  for (const pz of pending) {
    const z = pz.acc;
    const ticketsOf = (ms: ProvModel[]) => ms.reduce((a, pm) => a + pm.pd.tickets, 0);
    if (z.earlyTail) {
      out.push({ zone: mkZone(z.members, z.prices, z.earlyTail, false), tickets: ticketsOf(z.members) });
    } else if (pz.groups.length <= 1) {
      const g = pz.groups[0];
      out.push({ zone: mkZone(z.members, z.prices, g?.fit.rule ?? null, g?.fit.lowConfidence ?? false, g?.fit), tickets: ticketsOf(z.members) });
    } else {
      for (const g of pz.groups) out.push({ zone: mkZone(g.members, z.prices, g.fit.rule, g.fit.lowConfidence, g.fit), tickets: ticketsOf(g.members) });
      if (pz.rest.length) {
        out.push({ zone: mkZone(pz.rest, z.prices, null, false), tickets: ticketsOf(pz.rest) });
        notes.push(`同一价格档的省份在 ${last}kg 以上出现了 ${pz.groups.length} 种续重规则，已拆分；没有重货样本的省份续重留空，请手工补充。`);
      }
    }
  }

  out.sort((a, b) => (a.zone.prices[0] ?? 1e9) - (b.zone.prices[0] ?? 1e9) || b.tickets - a.tickets);
  out.forEach((o, i) => { o.zone.id = `z${i + 1}`; o.zone.name = zoneName(i); });

  let sheetFee: number | undefined;
  if (m.cols.inSheet) {
    const counts = new Map<number, number>();
    const a = m.cols.inSheet;
    eachRow(m, mask, opts.rows, (i) => { if (a[i] > 0) { const v = round2(a[i]); counts.set(v, (counts.get(v) ?? 0) + 1); } });
    sheetFee = mode([...counts.entries()], true);
  }

  const quote: Quote = {
    name: '系统还原报价',
    origin: 'inferred',
    basis: m.priceBasis,
    breakpoints: bps,
    zones: out.map((o) => o.zone),
    sheetFee,
    createdAt: new Date().toISOString(),
  };
  if (opts.stats === false) return { quote, coverage: NaN, notes };
  attachStats(m, mask, quote);
  const t = quote.zones.reduce((a, z) => a + (z.stats?.tickets ?? 0), 0);
  const matched = quote.zones.reduce((a, z) => a + (z.stats?.matched ?? 0), 0);
  return { quote, coverage: t ? matched / t : 0, notes };
}

function fitTailWith(pts: Pt[], rule: TailRule): { matched: number; total: number } {
  let matched = 0, total = 0;
  for (const x of pts) {
    if (x.w <= rule.start + 1e-9) continue;
    total += x.c;
    if (Math.abs(round2(rule.base + rule.perKg * gOf(x.w - rule.start, rule.rounding)) - x.p) <= PRICE_TOL) matched += x.c;
  }
  return { matched, total };
}

function mkZone(members: ProvModel[], prices: (number | null)[], tail: TailRule | null, low: boolean, fit?: TailFit): QuoteZone {
  return {
    id: '',
    name: '',
    provinces: members.map((pm) => pm.pd.name),
    prices: [...prices],
    tail,
    stats: { tickets: 0, matched: 0, tailSamples: fit?.total ?? 0, tailMatched: fit?.matched ?? 0, tailLowConfidence: low || (fit !== undefined && fit.total < 3) || undefined },
  };
}

function mode(xs: number[]): number | undefined;
function mode(xs: [number, number][], weighted: true): number | undefined;
function mode(xs: number[] | [number, number][], weighted?: boolean): number | undefined {
  const counts = new Map<number, number>();
  if (weighted) for (const [v, c] of xs as [number, number][]) counts.set(v, (counts.get(v) ?? 0) + c);
  else for (const v of xs as number[]) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | undefined, bc = -1;
  for (const [v, c] of counts) if (c > bc) { bc = c; best = v; }
  return best;
}

/** 用核对结果回填每个分区的覆盖统计 */
export function attachStats(m: Model, mask: Uint8Array, q: Quote, systemProvinces: string[] = []): void {
  const r = checkQuote(m, q, mask, systemProvinces);
  const w = m.cols.weight!;
  q.zones.forEach((z, zi) => {
    const row = r.cells[zi];
    const tickets = row.reduce((a, c) => a + c.n, 0);
    const matched = row.reduce((a, c) => a + c.match + c.system, 0);
    let tailSamples = 0, tailMatched = 0;
    if (z.tail) {
      for (let i = 0; i < m.n; i++) {
        if (r.zones[i] !== zi || r.status[i] === 4 || !(w[i] > z.tail.start + 1e-9)) continue;
        tailSamples++;
        if (r.status[i] === 0 || r.status[i] === 5) tailMatched++;
      }
    }
    z.stats = { tickets, matched, tailSamples, tailMatched, tailLowConfidence: z.stats?.tailLowConfidence };
  });
}

/** 仅供单元测试 */
export const __test = { selectBreakpoints, truncateToTail, collect, fitTail, runsOf };
