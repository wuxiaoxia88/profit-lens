// 页面骨架：顶栏、线下成本提示条、筛选条、多选下拉。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDerived, useStore, type TabId } from '../app/store';
import { fmtInt, fmtMoney, fmtUnit } from '../app/format';
import { dayToString, NO_DATE, stringToDay } from '../engine/dataset';
import { aggregate, DEFAULT_FILTERS, opCostFor, type TriState } from '../engine/model';
import type { DictField } from '../engine/schema';
import { setThemePref, type ThemePref } from '../app/useTheme';
import { Tip } from './Tip';
import { Seg } from './Card';

export const TABS: { id: TabId; label: string; needs?: 'profit' | 'quote' }[] = [
  { id: 'overview', label: '经营总览' },
  { id: 'matrix', label: '流向 × 重量利润', needs: 'profit' },
  { id: 'structure', label: '结构占比' },
  { id: 'quote', label: '报价还原与核对', needs: 'quote' },
  { id: 'sim', label: '调价模拟', needs: 'quote' },
  { id: 'quality', label: '数据质检' },
  { id: 'help', label: '使用帮助' },
];

export function Header({ right }: { right?: ReactNode }) {
  const { s, dispatch } = useStore();
  const d = useDerived();
  const [theme, setTheme] = useState<ThemePref>(() => (document.documentElement.dataset.theme as ThemePref) ?? 'auto');
  const summary = useMemo(() => {
    if (!d) return null;
    const cust = d.model.data.dict.customer;
    let names = '';
    if (cust) {
      const used = new Set<number>();
      for (let i = 0; i < d.model.n && used.size < 4; i++) used.add(cust.codes[i]);
      names = [...used].map((c) => d.nameOf('customer', c)).filter((x) => x !== '（空）').join('、');
      if (cust.values.length > 4) names += ` 等 ${cust.values.length} 个`;
    }
    const range = Number.isFinite(d.model.minDay) ? `${dayToString(d.model.minDay)} ~ ${dayToString(d.model.maxDay)}` : '';
    return { names, range };
  }, [d]);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden>◎</span>
        <div>
          <div className="brand-name">盈亏透镜 <small>v{__APP_VERSION__}</small></div>
          <div className="brand-sub">网点客户发件盈亏分析 · 报价决策</div>
        </div>
      </div>
      {summary && (
        <div className="ds-chip" title={s.data?.sources.map((x) => `${x.fileName}：${x.rows} 行`).join('\n')}>
          <b>{summary.names || '未命名客户'}</b>
          <span>{summary.range}</span>
          <span>{fmtInt(d!.model.n)} 单{s.loadMs > 0 ? ` · ${(s.loadMs / 1000).toFixed(1)} 秒导入` : ''}</span>
        </div>
      )}
      <div className="top-actions">
        {right}
        <label className="switch" title="匿名模式：客户名、面单账号显示为代号，适合截图分享">
          <input type="checkbox" checked={s.anonymize} onChange={(e) => dispatch({ type: 'anonymize', on: e.target.checked })} />
          匿名
        </label>
        <select
          className="theme-select"
          aria-label="外观"
          value={theme}
          onChange={(e) => { const v = e.target.value as ThemePref; setTheme(v); setThemePref(v); }}
        >
          <option value="auto">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>
    </header>
  );
}

function NumInput({ value, onChange, label, suffix, width = 84 }: { value: number; onChange: (v: number) => void; label: string; suffix: string; width?: number }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);
  return (
    <label className="num-input">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        style={{ width }}
        value={text}
        placeholder="0"
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
      />
      <em>{suffix}</em>
    </label>
  );
}

/** 醒目提示：系统利润只是毛利 + 线下成本设置 */
export function OpCostBar() {
  const { s, dispatch } = useStore();
  const d = useDerived();
  const tot = useMemo(() => (d && d.model.caps.profit ? aggregate(d.model, d.mask, null, 1) : null), [d]);
  const op = s.opCost;
  const set = (patch: Partial<typeof op>) => dispatch({ type: 'opCost', opCost: { ...op, ...patch } });
  const unset = op.perTicket === 0 && op.fixedTotal === 0;
  if (!d || !d.model.caps.profit) return null;
  const n = tot!.n[0];
  const profit = tot!.sum.profit![0];
  const opc = opCostFor(op, n, n);
  const net = profit - opc;
  return (
    <div className={`opbar ${unset ? 'opbar-unset' : ''}`} role="note">
      <div className="opbar-msg">
        <span className="opbar-icon" aria-hidden>⚠</span>
        <div>
          <b>系统「利润」只是毛利</b>，没有包含网点自己承担的线下操作与管理成本（装卸、分拣人工、场地、管理人员等）。
          {unset ? <b className="opbar-hint"> 请先设置线下成本，否则看到的利润偏高。</b> : null}
        </div>
      </div>
      <div className="opbar-inputs">
        <NumInput label="线下成本" suffix="元/票" value={op.perTicket} onChange={(v) => set({ perTicket: v })} />
        <NumInput label="+ 固定总额" suffix="元" width={100} value={op.fixedTotal} onChange={(v) => set({ fixedTotal: v })} />
        <Tip metric="opCost" />
        <div className="opbar-result">
          <span>毛利 <b>{fmtMoney(profit)}</b></span>
          <span>− 线下 <b>{fmtMoney(opc)}</b></span>
          <span className={net < 0 ? 'neg' : 'pos'}>= 纯利 <b>{fmtMoney(net)}</b>（单票 {fmtUnit(n ? net / n : NaN)}）</span>
          <Tip metric="net" />
        </div>
      </div>
    </div>
  );
}

export function MultiSelect({ label, options, value, onChange }: { label: string; options: { value: number; label: string; count?: number }[]; value: Set<number> | null; onChange: (v: Set<number> | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = options.filter((o) => !q || o.label.includes(q));
  const selected = value ?? new Set(options.map((o) => o.value));
  const toggle = (v: number) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next.size === options.length ? null : next);
  };
  return (
    <div className="ms" ref={ref}>
      <button type="button" className={`ms-btn ${value ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}：{value ? `已选 ${value.size}/${options.length}` : '全部'} ▾
      </button>
      {open && (
        <div className="ms-pop">
          {options.length > 8 && <input className="ms-search" placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="ms-quick">
            <button type="button" onClick={() => onChange(null)}>全选</button>
            <button type="button" onClick={() => onChange(new Set())}>清空</button>
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o.value}>
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
                {o.count !== undefined && <em>{fmtInt(o.count)}</em>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TRI: { value: TriState; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' },
];

export function FilterBar() {
  const { s, dispatch } = useStore();
  const d = useDerived();
  const f = s.filters;
  const m = d?.model;
  const dictOptions = useMemo(() => {
    if (!m) return {} as Record<string, { value: number; label: string; count: number }[]>;
    const out: Record<string, { value: number; label: string; count: number }[]> = {};
    for (const field of ['account', 'signStatus', 'customer'] as DictField[]) {
      const col = m.data.dict[field];
      if (!col) continue;
      const counts = new Float64Array(col.values.length);
      for (let i = 0; i < m.n; i++) counts[col.codes[i]]++;
      out[field] = col.values.map((_, c) => ({ value: c, label: d!.nameOf(field, c), count: counts[c] })).filter((o) => o.count > 0).sort((a, b) => b.count - a.count);
    }
    return out;
  }, [m, d?.nameOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const provOptions = useMemo(() => {
    if (!m) return [];
    const counts = new Float64Array(m.provNames.length);
    for (let i = 0; i < m.n; i++) counts[m.prov[i]]++;
    return m.provNames.map((p, i) => ({ value: i, label: p, count: counts[i] })).sort((a, b) => b.count - a.count);
  }, [m]);
  if (!d || !m) return null;
  const set = (patch: Partial<typeof f>) => dispatch({ type: 'filters', filters: { ...f, ...patch } });
  const has = (k: DictField) => !!m.data.dict[k];
  const dirty = JSON.stringify(f, (_, v) => (v instanceof Set ? [...v] : v)) !== JSON.stringify(DEFAULT_FILTERS);
  return (
    <div className="filterbar">
      {m.day && Number.isFinite(m.minDay) && (
        <div className="date-range">
          <span>揽收日期</span>
          <input type="date" value={dayToString(f.dateFrom ?? m.minDay)} min={dayToString(m.minDay)} max={dayToString(m.maxDay)}
            onChange={(e) => { const v = stringToDay(e.target.value); set({ dateFrom: v === NO_DATE || v <= m.minDay ? null : v }); }} />
          <span>~</span>
          <input type="date" value={dayToString(f.dateTo ?? m.maxDay)} min={dayToString(m.minDay)} max={dayToString(m.maxDay)}
            onChange={(e) => { const v = stringToDay(e.target.value); set({ dateTo: v === NO_DATE || v >= m.maxDay ? null : v }); }} />
        </div>
      )}
      {dictOptions.customer && dictOptions.customer.length > 1 && <MultiSelect label="结算对象" options={dictOptions.customer} value={f.customers} onChange={(v) => set({ customers: v })} />}
      {dictOptions.account && <MultiSelect label="面单账号" options={dictOptions.account} value={f.accounts} onChange={(v) => set({ accounts: v })} />}
      {provOptions.length > 0 && <MultiSelect label="流向" options={provOptions} value={f.provinces} onChange={(v) => set({ provinces: v })} />}
      {dictOptions.signStatus && <MultiSelect label="签收状态" options={dictOptions.signStatus} value={f.signStatus} onChange={(v) => set({ signStatus: v })} />}
      {has('returned') && <div className="tri"><span>退件</span><Seg size="sm" value={f.returned} options={TRI} onChange={(v) => set({ returned: v })} /></div>}
      {has('selfSign') && <div className="tri"><span>自发自签</span><Seg size="sm" value={f.selfSign} options={TRI} onChange={(v) => set({ selfSign: v })} /></div>}
      {has('shipped') && <div className="tri"><span>已发货</span><Seg size="sm" value={f.shipped} options={TRI} onChange={(v) => set({ shipped: v })} /></div>}
      <label className="chk" title="剔除结算重量为 0 或运费为 0 的单">
        <input type="checkbox" checked={f.excludeAbnormal} onChange={(e) => set({ excludeAbnormal: e.target.checked })} /> 剔除异常单
      </label>
      <div className="filter-count">
        筛选后 <b>{fmtInt(d.count)}</b> / {fmtInt(m.n)} 单
        {dirty && <button type="button" className="link" onClick={() => dispatch({ type: 'filters', filters: DEFAULT_FILTERS })}>重置</button>}
      </div>
    </div>
  );
}
