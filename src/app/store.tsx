// 全局状态：数据集、筛选、线下成本、重量段、报价等。派生计算（筛选掩码、重量段）集中在 useDerived 里做一次。
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { computeBands, DEFAULT_BREAKPOINTS } from '../engine/bands';
import type { DatasetData } from '../engine/dataset';
import { applyFilters, buildModel, DEFAULT_FILTERS, type Filters, type Model, type OpCost } from '../engine/model';
import { inferQuote, type InferResult } from '../engine/quote/infer';
import { detectPricePeriods, periodMask, type PricePeriod } from '../engine/quote/periods';
import type { Quote } from '../engine/quote/types';
import type { DictField } from '../engine/schema';
import { DEFAULT_PROVINCE_NOTES, type ProvinceNotes } from '../engine/notes';
import type { ParsedSheet } from '../engine/quote/workbook';

export type TabId = 'customers' | 'overview' | 'matrix' | 'structure' | 'quote' | 'sim' | 'quality' | 'help';

export interface LoadingState {
  stage: '识别表头' | '解析数据' | '建立分析模型';
  files: string[];
  fileIndex: number;
  fraction: number;
  rows: number;
  startedAt: number;
}

export interface State {
  data: DatasetData | null;
  model: Model | null;
  filters: Filters;
  opCost: OpCost;
  bandsOverride: number[] | null;
  autoBands: number[];
  tab: TabId;
  anonymize: boolean;
  loading: LoadingState | null;
  error: string | null;
  uploadedQuote: Quote | null;
  simQuote: Quote | null;
  periodIdx: number | null;
  loadMs: number;
  provinceNotes: ProvinceNotes;
  /** 上传的多客户报价工作簿；assign：结算对象名 → 工作表名（用户可改） */
  quoteBook: QuoteBook | null;
}

export interface QuoteBook {
  fileName: string;
  sheets: ParsedSheet[];
  assign: Record<string, string>;
  /** 自动匹配时只靠括号别名命中的，需要用户确认 */
  weak: string[];
}

type Action =
  | { type: 'data'; data: DatasetData; loadMs: number }
  | { type: 'clear' }
  | { type: 'filters'; filters: Filters }
  | { type: 'opCost'; opCost: OpCost }
  | { type: 'bands'; bands: number[] | null }
  | { type: 'tab'; tab: TabId }
  | { type: 'anonymize'; on: boolean }
  | { type: 'loading'; loading: LoadingState | null }
  | { type: 'error'; error: string | null }
  | { type: 'uploadedQuote'; quote: Quote | null }
  | { type: 'simQuote'; quote: Quote | null }
  | { type: 'period'; idx: number | null }
  | { type: 'provinceNotes'; notes: ProvinceNotes }
  | { type: 'quoteBook'; book: QuoteBook | null }
  | { type: 'assign'; customer: string; sheet: string | null };

const LS = 'profit-lens:v1:';
function loadLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(LS + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key: string, v: unknown) {
  try { localStorage.setItem(LS + key, JSON.stringify(v)); } catch { /* 隐私模式下忽略 */ }
}

const initial: State = {
  data: null,
  model: null,
  filters: DEFAULT_FILTERS,
  // 线下成本默认 0.35 元/票（客服、操作、运输、管理），可在页面顶部修改
  opCost: loadLS<OpCost>('opCost', { perTicket: 0.35, fixedTotal: 0 }),
  bandsOverride: loadLS<number[] | null>('bands', null),
  autoBands: DEFAULT_BREAKPOINTS,
  tab: 'overview',
  anonymize: loadLS('anonymize', false),
  loading: null,
  error: null,
  uploadedQuote: null,
  simQuote: null,
  periodIdx: null,
  loadMs: 0,
  provinceNotes: loadLS<ProvinceNotes>('provinceNotes', DEFAULT_PROVINCE_NOTES),
  quoteBook: null,
};

/** 默认分析重量段：用还原出的报价断点（与客户报价一致），再补上常用的大重量分界 */
function autoBandsFor(m: Model): number[] {
  if (!m.caps.quote || !m.cols.price) return DEFAULT_BREAKPOINTS;
  try {
    const all = new Uint8Array(m.n).fill(1);
    const bps = inferQuote(m, all).quote.breakpoints;
    const extra = [0.5, 1, 5, 10].filter((b) => !bps.some((x) => Math.abs(x - b) < 0.11));
    const merged = [...new Set([...bps, ...extra])].sort((a, b) => a - b);
    return merged.length > 12 ? bps : merged;
  } catch {
    return DEFAULT_BREAKPOINTS;
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'data': {
      const model = buildModel(a.data);
      const multi = (a.data.dict.customer?.values.filter(Boolean).length ?? 0) > 1;
      return { ...s, data: a.data, model, filters: DEFAULT_FILTERS, autoBands: autoBandsFor(model), loading: null, error: null, uploadedQuote: null, simQuote: null, periodIdx: null, loadMs: a.loadMs, tab: multi ? 'customers' : 'overview' };
    }
    case 'clear': return { ...s, data: null, model: null, uploadedQuote: null, simQuote: null };
    case 'filters': return { ...s, filters: a.filters, periodIdx: null };
    case 'opCost': return { ...s, opCost: a.opCost };
    case 'bands': return { ...s, bandsOverride: a.bands };
    case 'tab': return { ...s, tab: a.tab };
    case 'anonymize': return { ...s, anonymize: a.on };
    case 'loading': return { ...s, loading: a.loading };
    case 'error': return { ...s, error: a.error, loading: null };
    case 'uploadedQuote': return { ...s, uploadedQuote: a.quote };
    case 'simQuote': return { ...s, simQuote: a.quote };
    case 'period': return { ...s, periodIdx: a.idx };
    case 'provinceNotes': return { ...s, provinceNotes: a.notes };
    case 'quoteBook': return { ...s, quoteBook: a.book };
    case 'assign': {
      if (!s.quoteBook) return s;
      const assign = { ...s.quoteBook.assign };
      if (a.sheet) assign[a.customer] = a.sheet; else delete assign[a.customer];
      return { ...s, quoteBook: { ...s.quoteBook, assign, weak: s.quoteBook.weak.filter((c) => c !== a.customer) } };
    }
  }
}

interface Ctx {
  s: State;
  dispatch: (a: Action) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  useEffect(() => saveLS('opCost', s.opCost), [s.opCost]);
  useEffect(() => saveLS('bands', s.bandsOverride), [s.bandsOverride]);
  useEffect(() => saveLS('anonymize', s.anonymize), [s.anonymize]);
  useEffect(() => saveLS('provinceNotes', s.provinceNotes), [s.provinceNotes]);
  const value = useMemo(() => ({ s, dispatch }), [s]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}

// ───────────────────────── 派生数据 ─────────────────────────

export interface Derived {
  model: Model;
  mask: Uint8Array;
  count: number;
  bands: number[];
  bandKey: Uint8Array;
  /** 显示名（匿名模式下替换为代号） */
  nameOf: (field: DictField, code: number) => string;
}

export function useDerived(): Derived | null {
  const { s } = useStore();
  const model = s.model;
  const filtered = useMemo(() => (model ? applyFilters(model, s.filters) : null), [model, s.filters]);
  const bands = s.bandsOverride ?? s.autoBands;
  const bandKey = useMemo(() => (model?.cols.weight ? computeBands(model.cols.weight, bands) : new Uint8Array(model?.n ?? 0)), [model, bands]);
  const anon = s.anonymize;
  const nameOf = useCallback(
    (field: DictField, code: number) => {
      const v = model?.data.dict[field]?.values[code] ?? '';
      if (!anon) return v || '（空）';
      if (field === 'customer' || field === 'customerCode') return '客户' + String.fromCharCode(65 + (code % 26)) + (code >= 26 ? Math.floor(code / 26) : '');
      if (field === 'account' || field === 'accountName') return '账号' + (code + 1);
      return v || '（空）';
    },
    [model, anon],
  );
  return useMemo(() => {
    if (!model || !filtered) return null;
    return { model, mask: filtered.mask, count: filtered.count, bands, bandKey, nameOf };
  }, [model, filtered, bands, bandKey, nameOf]);
}

// ───────────────────────── 报价推断（按筛选结果缓存） ─────────────────────────

export interface InferenceBundle {
  periods: PricePeriod[];
  /** 当前选中时段（或全部）的推断结果 */
  result: InferResult | null;
  periodIdx: number | null;
  /** 推断所用掩码（时段 ∩ 筛选） */
  mask: Uint8Array;
  error: string | null;
}

const inferCache = new WeakMap<Uint8Array, Map<string, InferenceBundle>>();
const periodCache = new WeakMap<Uint8Array, PricePeriod[]>();

export function useInference(): InferenceBundle | null {
  const d = useDerived();
  const { s } = useStore();
  return useMemo(() => {
    if (!d || !d.model.caps.quote || !d.model.cols.price) return null;
    let periods = periodCache.get(d.mask);
    if (!periods) { periods = detectPricePeriods(d.model, d.mask); periodCache.set(d.mask, periods); }
    // 默认用最新的价格时段
    const idx = periods.length > 1 ? (s.periodIdx ?? periods.length - 1) : null;
    const key = String(idx);
    let byKey = inferCache.get(d.mask);
    if (!byKey) { byKey = new Map(); inferCache.set(d.mask, byKey); }
    let b = byKey.get(key);
    if (!b) {
      const mask = idx === null ? d.mask : periodMask(d.model, d.mask, periods[idx]);
      try {
        b = { periods, result: inferQuote(d.model, mask), periodIdx: idx, mask, error: null };
      } catch (e) {
        b = { periods, result: null, periodIdx: idx, mask, error: e instanceof Error ? e.message : String(e) };
      }
      byKey.set(key, b);
    }
    return b;
  }, [d, s.periodIdx]);
}
