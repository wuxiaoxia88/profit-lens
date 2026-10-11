// 客户报价工作簿解析：一个工作表一个客户，把网点常见的两类报价单格式转成 Quote。
//
// 格式一（按省份逐行）：
//   城市 | 0-1.2kg | 1.21-1.5kg | 1.51-2kg | 2.01-3kg | 3kg以上面单款 | 3kg以上（0kg开始）
//   下方另有「省份 | 1KG以内 | 1KG以上」的新疆/西藏小表；备注里有「北京上海加收：1元/票」「单号先付2.2元/单」等。
// 格式二（省份分组 + 合并单元格）：
//   省份 | 重量≦1kg | 1kg<重量≦1.5kg | … | 首重 | 续重，行首为「浙江、安徽、上海、江苏」这样的分组，
//   空白单元格表示与上一行合并；续重公式写在备注里（如「2kg以上，价格=首重+（重量-1）*每公斤价格」）。
//
// 解析不了的约定（如「北京5KG以上续重加收1元/公斤」「日发件需达4000票」）记入 warnings，交给人工确认。
import { round2, zoneName, type Quote, type QuoteZone, type Rounding, type TailRule } from './types';

export interface ParsedSheet {
  sheet: string;
  title: string;
  quote: Quote | null;
  status: 'ok' | 'partial' | 'failed';
  warnings: string[];
  notes: string[];
  sheetFee?: number;
  effectiveFrom?: string; // YYYY-MM-DD
  /** 报价单里单列的地市特价（如四川甘孜、阿坝），只做提示 */
  specialAreas: string[];
}

const GROUP_ALIASES: Record<string, string[]> = {
  江浙沪皖: ['江苏', '浙江', '上海', '安徽'],
  江浙沪: ['江苏', '浙江', '上海'],
  京津冀: ['北京', '天津', '河北'],
  新藏: ['新疆', '西藏'],
};

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, '').trim();

function num(s: string | undefined): number | null {
  const t = (s ?? '').trim().replace(/[¥￥元,]/g, '');
  if (!t || t.startsWith('=')) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const PROVINCE_NAMES = ['黑龙江', '内蒙古', '新疆', '西藏', '宁夏', '广西', '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'];

/**
 * 单元格里的省份列表。支持「浙江、安徽」「四川重庆河北」「江浙沪皖」「广西壮族自治区」等写法。
 * 去掉省份名和分隔符后若还剩较多文字（如「注：北京、上海+1」这种备注），视为不是省份行，返回空数组。
 */
export function provincesIn(cell: string): string[] {
  let text = cell;
  for (const [alias, list] of Object.entries(GROUP_ALIASES)) text = text.split(alias).join(list.join('、'));
  const found: string[] = [];
  let rest = text.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)/g, '');
  for (const p of PROVINCE_NAMES) {
    if (rest.includes(p)) { found.push(p); rest = rest.split(p).join(''); }
  }
  const leftover = rest.replace(/[、,，;；\s/．.和及等件]/g, '');
  if (!found.length || leftover.length > 2) return [];
  return found;
}

interface Cols {
  prov: number;
  region: number;
  bands: { col: number; upper: number }[];
  base: number; // 3kg以上面单款
  perKg: number; // 续重单价
  first: number; // 首重
}

function upperOfHeader(h: string): number | null {
  if (/以上|首重|续重|面单/.test(h) || h.includes('/')) return null;
  if (!/kg|公斤|重量|≦|≤|</i.test(h)) return null;
  const nums = h.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const v = Number(nums[nums.length - 1]);
  return v > 0 && v < 100 ? v : null;
}

function classify(header: string[]): Cols | null {
  const h = header.map(clean);
  const cols: Cols = { prov: -1, region: -1, bands: [], base: -1, perKg: -1, first: -1 };
  h.forEach((c, i) => {
    if (!c) return;
    if (/^(重量)?(省份|城市)$|省份$/.test(c) && cols.prov < 0) cols.prov = i;
    else if (/^区域$/.test(c)) cols.region = i;
    else if (/面单款/.test(c)) cols.base = i;
    else if (/首重/.test(c)) cols.first = i;
    else if (/续重|0kg开始|每kg/i.test(c)) cols.perKg = i;
    else {
      const u = upperOfHeader(c);
      if (u !== null) cols.bands.push({ col: i, upper: u });
    }
  });
  if (cols.prov < 0 || !cols.bands.length) return null;
  cols.bands.sort((a, b) => a.upper - b.upper);
  return cols;
}

interface Row {
  provinces: string[];
  region: string;
  bands: (number | null)[];
  base: number | null;
  perKg: number | null;
  first: number | null;
}

interface Special {
  firstPrice: number;
  perKg: number;
  firstUpTo: number;
}

function parseNotes(notes: string) {
  const text = notes.replace(/\s+/g, '');
  const surcharge: Record<string, number> = {};
  const both = /北京件?[、，,和及]?上海件?[^。；;]{0,8}?(?:加收|\+)[：:]?(\d+(?:\.\d+)?)/.exec(text);
  if (both) surcharge['北京'] = surcharge['上海'] = Number(both[1]);
  for (const city of ['北京', '上海']) {
    const m = new RegExp(`${city}件?另?加收[：:]?(\\d+(?:\\.\\d+)?)元/票`).exec(text);
    if (m) surcharge[city] = Number(m[1]);
  }
  const sheetFee = /单号(?:先付|现付)(\d+(?:\.\d+)?)/.exec(text)?.[1];
  let effective: string | undefined;
  for (const m of text.matchAll(/(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?(?:起)?实施/g)) {
    effective = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  // 续重公式
  let origin: number | null = null;
  let baseFromNote: number | null = null;
  const f1 = /价格=首重\+[（(]重量-(\d+(?:\.\d+)?)[）)]/.exec(text);
  if (f1) origin = Number(f1[1]);
  const f2 = /价格=(?:电子)?面单(\d+(?:\.\d+)?)?元?\+重量/.exec(text) ?? /面单\+重量取整\*单价/.exec(text);
  if (f2) { origin = 0; if (f2[1]) baseFromNote = Number(f2[1]); }
  if (/0kg开始/i.test(text)) origin = 0;
  if (/从第一公斤开始续重/.test(text)) origin = 1;
  // 只认「首重4元 2kg以上，价格=…」这种总述，避免把新藏/偏远备注里的首重当成通用首重
  const firstNote = /首重(\d+(?:\.\d+)?)元(?=\d+(?:\.\d+)?(?:kg|公斤)以上)/i.exec(text);
  const threshold = /(\d+(?:\.\d+)?)kg以上[，,]?(?:价格|为|结算)/i.exec(text) ?? /超(\d+(?:\.\d+)?)公斤以上/.exec(text);
  const rounding: Rounding = /不足0\.5kg按0\.5kg|0\.5kg计算/i.test(text) ? 'ceil0.5' : 'ceil';
  // 新藏、偏远省份的「首重 X 元，超重 Y KG 按首重 X、续重 Z 元/公斤」
  const special = new Map<string, Special>();
  for (const m of text.matchAll(/([^。；;\d]{2,30}?)件?首重是?(\d+(?:\.\d+)?)元[，,]?超(?:重|过)(\d+(?:\.\d+)?)(?:KG|kg|公斤)[^。；;]*?续重(\d+(?:\.\d+)?)元\/公斤/g)) {
    const provs = provincesIn(m[1].replace(/件$/, ''));
    for (const p of provs) special.set(p, { firstPrice: Number(m[2]), firstUpTo: Number(m[3]), perKg: Number(m[4]) });
  }
  for (const m of text.matchAll(/([^。；;\d]{2,30}?)件?超(?:重|过)(\d+(?:\.\d+)?)(?:KG|kg|公斤)[^。；;]*?首重(\d+(?:\.\d+)?)元[，,]?续重(\d+(?:\.\d+)?)元\/公斤/g)) {
    for (const p of provincesIn(m[1].replace(/件$/, ''))) if (!special.has(p)) special.set(p, { firstPrice: Number(m[3]), firstUpTo: Number(m[2]), perKg: Number(m[4]) });
  }
  const unsupported: string[] = [];
  for (const m of text.matchAll(/[^。；;]*?\d+(?:KG|kg|公斤)以上续重加收[^。；;]*/g)) unsupported.push(m[0]);
  for (const m of text.matchAll(/[^。；;]*?每日发件票数[^。；;]*/g)) unsupported.push(m[0]);
  return {
    surcharge,
    sheetFee: sheetFee ? Number(sheetFee) : undefined,
    effective,
    origin,
    baseFromNote,
    firstNote: firstNote ? Number(firstNote[1]) : null,
    threshold: threshold ? Number(threshold[1]) : null,
    rounding,
    special,
    unsupported,
    hasFormula: f1 !== null || f2 !== null || /0kg开始|从第一公斤开始续重|首重价格\+续重价格/i.test(text),
  };
}

export function parseQuoteSheet(sheet: string, rows: string[][]): ParsedSheet {
  const res: ParsedSheet = { sheet, title: '', quote: null, status: 'failed', warnings: [], notes: [], specialAreas: [] };
  const hi = rows.slice(0, 10).findIndex((r) => classify(r) !== null);
  if (hi < 0) {
    res.warnings.push('没有找到「省份/城市 + 重量段」表头');
    return res;
  }
  res.title = rows.slice(0, hi).map((r) => r.filter(Boolean).join(' ')).filter(Boolean).join(' / ');
  const cols = classify(rows[hi])!;
  const breakpoints = cols.bands.map((b) => b.upper);
  const last = breakpoints[breakpoints.length - 1];

  // 主表
  const body: Row[] = [];
  let sub: { first: number; perKg: number; upTo: number } | null = null;
  const subRows: { provinces: string[]; first: number | null; perKg: number | null }[] = [];
  let i = hi + 1;
  let lastRegion = '';
  for (; i < rows.length; i++) {
    const r = rows[i];
    const head = clean(r[cols.prov]);
    // 新藏小表的表头：「省份 | 1KG以内 | … | 1KG以上」
    if (/^(省份|城市)$/.test(head)) {
      const h = r.map(clean);
      const fc = h.findIndex((c) => /以内|以下|首重/.test(c));
      const pc = h.findIndex((c, k) => k !== fc && /以上|续重/.test(c));
      const upTo = Number(/(\d+(?:\.\d+)?)/.exec(h[fc] ?? '')?.[1] ?? 1);
      if (fc >= 0 && pc >= 0) sub = { first: fc, perKg: pc, upTo };
      continue;
    }
    const provs = provincesIn(r[cols.prov] ?? '');
    if (!provs.length) {
      const reg = cols.region >= 0 ? clean(r[cols.region]) : '';
      if (reg) lastRegion = reg;
      // 「特殊区域 | 甘孜 | 1.8 | 2.6 | … | 10」这类地市特价行：记成提示，不改省份价格
      const nums = cols.bands.map((b) => num(r[b.col])).filter((v) => v !== null);
      const name = clean(r[cols.prov]);
      if (name && name.length <= 8 && (nums.length || (cols.perKg >= 0 && num(r[cols.perKg]) !== null)) && (/特殊|偏远/.test(lastRegion) || !/[：:。]/.test(name))) {
        const vals = cols.bands.map((b) => (num(r[b.col]) !== null ? `${b.upper}kg内 ${num(r[b.col])}` : '')).filter(Boolean);
        const pk = cols.perKg >= 0 ? num(r[cols.perKg]) : null;
        res.specialAreas.push(`${name}：${vals.join('，')}${pk !== null ? `，续重 ${pk} 元/kg` : ''}`);
        continue;
      }
      if (r.some((c) => clean(c))) break; // 备注开始
      continue;
    }
    if (sub) {
      const prev = subRows[subRows.length - 1];
      const first = num(r[sub.first]) ?? (num(r[sub.perKg]) === null ? prev?.first ?? null : null);
      const perKg = num(r[sub.perKg]) ?? (num(r[sub.first]) === null ? prev?.perKg ?? null : null);
      subRows.push({ provinces: provs, first, perKg });
      continue;
    }
    if (cols.region >= 0 && clean(r[cols.region])) lastRegion = clean(r[cols.region]);
    const row: Row = {
      provinces: provs,
      region: lastRegion,
      bands: cols.bands.map((b) => num(r[b.col])),
      base: cols.base >= 0 ? num(r[cols.base]) : null,
      perKg: cols.perKg >= 0 ? num(r[cols.perKg]) : null,
      first: cols.first >= 0 ? num(r[cols.first]) : null,
    };
    // 合并单元格：首段为空 → 与上一行相同
    const prev = body[body.length - 1];
    if (prev && row.bands[0] === null && row.bands.every((v) => v === null)) {
      row.bands = [...prev.bands];
      if (row.base === null) row.base = prev.base;
      if (row.first === null) row.first = prev.first;
      if (row.perKg === null) row.perKg = prev.perKg;
    }
    body.push(row);
  }
  const notesText = rows.slice(i).map((r) => r.filter((c) => c && !c.startsWith('=')).join(' ')).filter(Boolean);
  res.notes = notesText;
  const nt = parseNotes(notesText.join('\n'));
  res.sheetFee = nt.sheetFee;
  res.effectiveFrom = nt.effective;
  if (!body.length && !subRows.length) {
    res.warnings.push('表头下面没有读到省份行');
    return res;
  }

  // 每个省份 → 价格 + 续重
  /** 续重各参数是表格明确给出的（table），还是按版式推断的（infer）——备注里的规则只覆盖推断出来的部分 */
  type Src = 'table' | 'infer';
  interface ProvPrice { prices: (number | null)[]; tail: TailRule | null; region: string; src: { start: Src; base: Src; perKg: Src } }
  const byProv = new Map<string, ProvPrice>();
  const lowerOf = (b: number) => (b === 0 ? 0 : breakpoints[b - 1]);
  const firstBandFor = (upTo: number, price: number) => breakpoints.map((_, b) => (lowerOf(b) < upTo - 1e-9 ? price : null));

  for (const row of body) {
    let prices = [...row.bands];
    let tail: TailRule | null = null;
    const src: ProvPrice['src'] = { start: 'infer', base: row.base !== null || row.first !== null ? 'table' : 'infer', perKg: 'table' };
    const filled = prices.filter((v) => v !== null).length;
    if (row.base !== null && row.perKg !== null) {
      // 格式一：面单款 + 单价 × 取整重量（从 0kg 开始）
      tail = { start: nt.threshold ?? last, base: row.base, perKg: row.perKg, rounding: nt.rounding, origin: nt.origin ?? 0 };
    } else if (row.perKg !== null) {
      const origin = nt.origin ?? 1;
      if (filled === 1 && prices[0] !== null && breakpoints.length > 1) {
        // 只有首段有价（偏远/新藏常见）：首重后直接续重
        const up = breakpoints[0];
        tail = { start: up, base: row.first ?? prices[0], perKg: row.perKg, rounding: nt.rounding, origin: up };
        prices = prices.map((v, b) => (b === 0 ? v : null));
        src.base = 'table';
      } else {
        const lastFilled = prices.reduce<number>((acc, v, b) => (v !== null ? b : acc), -1);
        const start = nt.threshold ?? breakpoints[lastFilled] ?? last;
        // 「首重 +（重量 − 1）× 续重」里的首重 = 1kg 所在重量段的价格（如 ≤0.5、0.5–1 两段时取后者）
        const kg1 = breakpoints.findIndex((b) => b >= 1 - 1e-9);
        const firstKgPrice = origin === 1 && kg1 >= 0 ? prices[kg1] : null;
        const base = row.first ?? nt.baseFromNote ?? nt.firstNote ?? firstKgPrice ?? prices[0];
        if (base !== null) tail = { start, base, perKg: row.perKg, rounding: nt.rounding, origin: origin === 0 ? 0 : origin };
      }
    }
    for (const p of row.provinces) byProv.set(p, { prices: [...prices], tail: tail ? { ...tail } : null, region: row.region, src: { ...src } });
  }
  // 新藏小表
  for (const sr of subRows) {
    if (sr.first === null) continue;
    const upTo = sub?.upTo ?? 1;
    const perKg = sr.perKg ?? sr.first;
    for (const p of sr.provinces) {
      byProv.set(p, { prices: firstBandFor(upTo, sr.first), tail: { start: upTo, base: sr.first, perKg, rounding: nt.rounding, origin: upTo }, region: '', src: { start: 'table', base: 'table', perKg: 'table' } });
    }
  }
  // 备注里的「首重 X 元，超重 Y kg 按首重 X、续重 Z 元/公斤」：覆盖按版式推断的部分；与表格明确给出的值冲突时以表格为准并提示
  for (const [p, sp] of nt.special) {
    const cur = byProv.get(p);
    if (!cur) {
      byProv.set(p, { prices: firstBandFor(sp.firstUpTo, sp.firstPrice), tail: { start: sp.firstUpTo, base: sp.firstPrice, perKg: sp.perKg, rounding: 'ceil', origin: sp.firstUpTo }, region: '', src: { start: 'table', base: 'table', perKg: 'table' } });
      continue;
    }
    const t = cur.tail;
    const pick = (field: 'base' | 'perKg', noteVal: number) => {
      if (!t || cur.src[field] === 'infer') return noteVal;
      if (Math.abs(t[field] - noteVal) > 0.005) res.warnings.push(`${p}：表格${field === 'base' ? '首重' : '续重'} ${t[field]} 与备注 ${noteVal} 不一致，按表格核对`);
      return t[field];
    };
    const start = !t || cur.src.start === 'infer' ? sp.firstUpTo : t.start;
    // 首重/续重类规则按整公斤进位；「不足0.5kg按0.5kg」只用于通用的大货续重
    cur.tail = { start, base: pick('base', sp.firstPrice), perKg: pick('perKg', sp.perKg), rounding: 'ceil', origin: start };
    cur.prices = cur.prices.map((v, b) => (lowerOf(b) < start - 1e-9 ? v ?? cur.tail!.base : null));
  }
  // 北京、上海加收
  for (const [city, add] of Object.entries(nt.surcharge)) {
    const cur = byProv.get(city);
    if (!cur) continue;
    cur.prices = cur.prices.map((v) => (v === null ? null : round2(v + add)));
    if (cur.tail) cur.tail.base = round2(cur.tail.base + add);
  }
  for (const u of nt.unsupported) res.warnings.push(`未纳入核对：${u}`);
  const anyInferred = [...byProv.values()].some((pp) => pp.tail && pp.src.base === 'infer');
  if (anyInferred && !nt.hasFormula && cols.base < 0) res.warnings.push('报价单没写明续重公式，按「首重 +（重量 − 1）× 续重单价」推断，请确认');
  const gaps = [...byProv.entries()].filter(([, pp]) => {
    const lastPriced = pp.prices.reduce<number>((acc, v, b) => (v !== null ? b : acc), -1);
    const upTo = lastPriced >= 0 ? breakpoints[lastPriced] : 0;
    return pp.tail && pp.tail.start > upTo + 1e-9;
  });
  if (gaps.length) {
    const [, pp] = gaps[0];
    const lastPriced = pp.prices.reduce<number>((acc, v, b) => (v !== null ? b : acc), -1);
    res.warnings.push(`${gaps.map(([p]) => p).slice(0, 6).join('、')}${gaps.length > 6 ? '等' : ''}：${lastPriced >= 0 ? breakpoints[lastPriced] : 0}–${pp.tail!.start}kg 之间没有价格，这段重量的单无法核对`);
  }

  // 按价格 + 续重相同合并成分区
  const zones: QuoteZone[] = [];
  const keyOf = (pp: ProvPrice) => JSON.stringify([pp.prices, pp.tail]);
  const zoneIdx = new Map<string, number>();
  for (const [p, pp] of byProv) {
    const k = keyOf(pp);
    let zi = zoneIdx.get(k);
    if (zi === undefined) {
      zi = zones.length;
      zoneIdx.set(k, zi);
      zones.push({ id: `w${zi + 1}`, name: '', provinces: [], prices: pp.prices, tail: pp.tail });
    }
    zones[zi].provinces.push(p);
  }
  const regionOfZone = (z: QuoteZone) => byProv.get(z.provinces[0])?.region ?? '';
  zones.sort((a, b) => (a.prices[0] ?? 99) - (b.prices[0] ?? 99) || (a.tail?.perKg ?? 99) - (b.tail?.perKg ?? 99));
  const used = new Map<string, number>();
  zones.forEach((z, k) => {
    const reg = regionOfZone(z);
    if (reg) { const c = (used.get(reg) ?? 0) + 1; used.set(reg, c); z.name = c > 1 ? `${reg}-${c}` : reg; }
    else z.name = zoneName(k);
  });

  const covered = byProv.size;
  if (covered < 20) res.warnings.push(`只识别到 ${covered} 个省份`);
  const noTail = zones.filter((z) => !z.tail).flatMap((z) => z.provinces);
  if (noTail.length) res.warnings.push(`${noTail.join('、')} 没有续重规则，超出 ${last}kg 的单无法核对`);
  res.quote = {
    name: sheet,
    origin: 'uploaded',
    basis: 'sheet+transfer',
    breakpoints,
    zones,
    sheetFee: nt.sheetFee,
    createdAt: new Date().toISOString(),
  };
  res.status = res.warnings.length ? 'partial' : 'ok';
  return res;
}

export function parseQuoteWorkbook(sheets: { name: string; rows: string[][] }[]): ParsedSheet[] {
  return sheets.filter((s) => s.rows.some((r) => r.some(Boolean))).map((s) => parseQuoteSheet(s.name, s.rows)).filter((p) => p.quote || !/汇总/.test(p.sheet));
}

// ───────────────────────── 报价表 ↔ 结算对象 匹配 ─────────────────────────

/** 去掉括号、K1/CK 之类后缀、标点，得到用于匹配的核心名称 */
export function coreName(s: string): string {
  return s
    .replace(/[（(][^）)]*[）)]?/g, '')
    .replace(/(?:CK|K\d+|\d+)$/i, '')
    .replace(/[\s,，、&＆\-—_·.。]/g, '')
    .replace(/^二部/, '')
    .trim();
}

function bracketParts(s: string): string[] {
  return [...s.matchAll(/[（(]([^）)]+)[）)]?/g)].map((m) => m[1].replace(/\s/g, '')).filter((x) => x.length >= 2);
}

/**
 * 为每个结算对象找最可能的报价表：核心名称完全相同 > 一方包含另一方 > 括号内别名相同（弱匹配，需人工确认）。
 */
export function matchSheetsToCustomers(sheets: string[], customers: string[]): { assign: Record<string, string>; weak: string[] } {
  const assign: Record<string, string> = {};
  const weak: string[] = [];
  const sc = sheets.map((s) => ({ s, core: coreName(s), alias: bracketParts(s) }));
  for (const c of customers) {
    const cc = coreName(c);
    if (cc.length < 2) continue;
    const calias = bracketParts(c);
    let best: { s: string; score: number } | null = null;
    for (const x of sc) {
      let score = 0;
      if (x.core === cc) score = 3;
      else if (x.core.length >= 2 && (x.core.includes(cc) || cc.includes(x.core))) score = 2;
      else if (x.alias.some((a) => a === cc || calias.includes(a) || c.includes(a))) score = 1;
      if (score && (!best || score > best.score)) best = { s: x.s, score };
    }
    if (best) {
      assign[c] = best.s;
      if (best.score === 1) weak.push(c);
    }
  }
  return { assign, weak };
}
