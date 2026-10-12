// 客户总览：一份导出里有多个结算对象时，先看全网点：谁赚钱、谁亏钱、报价是否执行到位。
import { useCallback, useMemo, useRef, useState } from 'react';
import { rowsOf, type GroupRow } from '../app/analysis';
import { loadQuoteBook, useCustomerCheck } from '../app/book';
import { downloadXlsx } from '../app/exporter';
import { fmtInt, fmtKg, fmtMoney, fmtPct, fmtUnit } from '../app/format';
import { useDerived, useStore } from '../app/store';
import type { Theme } from '../app/theme';
import { Card, Kpi } from '../components/Card';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { Tip } from '../components/Tip';
import { aggregate, DEFAULT_FILTERS } from '../engine/model';
import { writeXlsx, type Cell, type SheetSpec } from '../engine/xlsxWriter';
import { quoteToSheetRows } from '../engine/quote/sheetExport';
import { SystemProvinceEditor } from '../components/SystemProvinceEditor';

interface CustRow extends GroupRow {
  name: string;
  type: string;
}

type SortKey = 'n' | 'net' | 'unitNet' | 'unitProfit' | 'under' | 'match';

export function CustomersPage() {
  const d = useDerived()!;
  const { s, dispatch } = useStore();
  const op = s.opCost;
  const book = s.quoteBook;
  const check = useCustomerCheck();
  const [sortKey, setSortKey] = useState<SortKey>('n');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cust = d.model.data.dict.customer!;
  const typeCol = d.model.data.dict.customerType;

  const rows = useMemo<CustRow[]>(() => {
    const a = aggregate(d.model, d.mask, cust.codes, cust.values.length);
    const typeOf = new Map<number, string>();
    if (typeCol) for (let i = 0; i < d.model.n; i++) if (!typeOf.has(cust.codes[i])) typeOf.set(cust.codes[i], typeCol.values[typeCol.codes[i]]);
    return rowsOf(a, cust.values, d.count, op)
      .filter((r) => r.n > 0)
      .map((r) => ({ ...r, name: d.nameOf('customer', r.key), type: typeOf.get(r.key) ?? '' }));
  }, [d, op, cust, typeCol]);

  const typeRows = useMemo(() => {
    const m = new Map<string, { type: string; customers: number; n: number; income: number; profit: number; opc: number }>();
    for (const r of rows) {
      const t = r.type || '（未标注）';
      const x = m.get(t) ?? { type: t, customers: 0, n: 0, income: 0, profit: 0, opc: 0 };
      x.customers++; x.n += r.n; x.income += r.income; x.profit += r.profit; x.opc += r.opc;
      m.set(t, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rows]);

  const total = useMemo(() => rows.reduce((a, r) => ({ n: a.n + r.n, profit: a.profit + r.profit, opc: a.opc + r.opc }), { n: 0, profit: 0, opc: 0 }), [rows]);
  const lossCust = rows.filter((r) => r.net < 0);
  const lossTickets = lossCust.reduce((a, r) => a + r.n, 0);

  // 按核对依据分开汇总：价格表 / 系统还原；「以系统为准」的单算作一致
  const totalsBy = useMemo(() => {
    const empty = () => ({ customers: 0, n: 0, checked: 0, match: 0, system: 0, under: 0, underAmt: 0, over: 0, overAmt: 0 });
    const t = { sheet: empty(), system: empty() };
    if (!check) return null;
    for (const c of check.byCustomer) {
      if (!c.n) continue;
      const x = t[c.source];
      x.customers++; x.n += c.n; x.checked += c.checked; x.match += c.match; x.system += c.system;
      x.under += c.under; x.underAmt += c.underAmt; x.over += c.over; x.overAmt += c.overAmt;
    }
    return t;
  }, [check]);
  const okRate = (c: { checked: number; match: number; system: number }) => (c.checked ? (c.match + c.system) / c.checked : NaN);

  const sorted = useMemo(() => {
    const kw = q.trim();
    const list = rows.filter((r) => !kw || r.name.includes(kw) || cust.values[r.key].includes(kw));
    const val = (r: CustRow): number => {
      const c = check?.byCode.get(r.key);
      switch (sortKey) {
        case 'n': return -r.n;
        case 'net': return r.net;
        case 'unitNet': return r.unitNet;
        case 'unitProfit': return r.unitProfit;
        case 'under': return c?.source === 'sheet' ? -c.underAmt : 1;
        case 'match': return c?.source === 'sheet' && c.checked ? (c.match + c.system) / c.checked : 2;
      }
    };
    return [...list].sort((a, b) => val(a) - val(b));
  }, [rows, sortKey, q, check, cust]);

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setBusy(true);
    try {
      dispatch({ type: 'quoteBook', book: await loadQuoteBook(f, d.model) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const view = (code: number) => {
    dispatch({ type: 'filters', filters: { ...DEFAULT_FILTERS, customers: new Set([code]) } });
    dispatch({ type: 'tab', tab: 'overview' });
  };

  const ranking = useCallback((t: Theme) => {
    const top = [...rows].sort((a, b) => b.n - a.n).slice(0, 30).sort((a, b) => b.net - a.net);
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const r = top[ps[0].dataIndex];
        return `<b>${r.name}</b>（${r.type}）<br/>${fmtInt(r.n)} 单，占 ${fmtPct(r.share)}<br/>单票收入 ${fmtUnit(r.unitIncome)}　单票毛利 ${fmtUnit(r.unitProfit)}<br/>单票纯利 <b>${fmtUnit(r.unitNet)}</b>　总纯利 <b>${fmtMoney(r.net)}</b>`;
      } },
      xAxis: { type: 'value', name: '元', ...axisStyle(t) },
      yAxis: { type: 'category', data: top.map((r) => r.name), inverse: true, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11, interval: 0, width: 120, overflow: 'truncate' } },
      series: [{ type: 'bar', data: top.map((r) => +r.net.toFixed(2)), barMaxWidth: 14,
        itemStyle: { color: (p: { value: number }) => (p.value < 0 ? t.div.neg[1] : t.series[0]), borderRadius: 3 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 10, formatter: (p: { value: number }) => fmtMoney(p.value, 0) } }],
    };
  }, [rows]);

  const quadrant = useCallback((t: Theme) => {
    const list = rows.filter((r) => r.n >= 100);
    const maxN = Math.max(...list.map((r) => r.n), 1);
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), formatter: (p: { dataIndex: number }) => {
        const r = list[p.dataIndex];
        return `<b>${r.name}</b><br/>${fmtInt(r.n)} 单<br/>单票纯利 ${fmtUnit(r.unitNet)}<br/>总纯利 ${fmtMoney(r.net)}`;
      } },
      xAxis: { type: 'log', name: '票数', ...axisStyle(t) },
      yAxis: { type: 'value', name: '单票纯利', ...axisStyle(t), min: (v: { min: number }) => Math.max(v.min, -2), max: (v: { max: number }) => Math.min(v.max, 2) },
      series: [{
        type: 'scatter',
        data: list.map((r) => [r.n, +r.unitNet.toFixed(3)]),
        symbolSize: (_: unknown, p: { dataIndex: number }) => 8 + 24 * Math.sqrt(list[p.dataIndex].n / maxN),
        itemStyle: { color: (p: { dataIndex: number }) => (list[p.dataIndex].unitNet < 0 ? t.div.neg[1] : t.series[0]), opacity: 0.85, borderColor: t.surface, borderWidth: 2 },
        label: { show: true, position: 'right', fontSize: 10, color: t.ink2, formatter: (p: { dataIndex: number }) => (list[p.dataIndex].n > maxN * 0.08 ? list[p.dataIndex].name : '') },
        labelLayout: { hideOverlap: true },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] },
      }],
    };
  }, [rows]);

  const exportTable = () => {
    const head: Cell[] = ['结算对象', '类型', '票数', '票量占比', '平均重量', '单票收入', '单票成本', '单票毛利', '总毛利', '线下成本', '总纯利', '单票纯利', '亏损票数', '核对依据', '参与核对', '一致率', '少收单数', '少收金额', '多收单数', '多收金额'];
    const out: Cell[][] = [head];
    for (const r of sorted) {
      const c = check?.byCode.get(r.key);
      out.push([r.name, r.type, r.n, +r.share.toFixed(5), +r.avgW.toFixed(3), +r.unitIncome.toFixed(4), +r.unitCost.toFixed(4), +r.unitProfit.toFixed(4), +r.profit.toFixed(2), +r.opc.toFixed(2), +r.net.toFixed(2), +r.unitNet.toFixed(4), r.lossN,
        c ? (c.source === 'sheet' ? c.sheet : '系统收费') : '', c?.checked ?? null, c && c.checked ? +((c.match + c.system) / c.checked).toFixed(4) : null, c?.under ?? null, c ? +c.underAmt.toFixed(2) : null, c?.over ?? null, c ? +c.overAmt.toFixed(2) : null]);
    }
    downloadXlsx(writeXlsx([{ name: '客户盈亏', rows: out, colWidths: [22, 10, 9, 9, 8, 9, 9, 9, 11, 10, 11, 9, 9, 18, 9, 8, 9, 10, 9, 10] }]), '客户盈亏与报价核对');
  };

  const usableSheets = book ? book.sheets.filter((x) => x.quote).map((x) => x.sheet) : [];
  const missing = useMemo(() => (check ? check.byCustomer.filter((c) => c.source === 'system' && c.n >= 30).sort((a, b) => b.n - a.n) : []), [check]);
  const exportMissing = () => {
    if (!check) return;
    const used = new Set<string>();
    const sheets: SheetSpec[] = [];
    const index: Cell[][] = [['结算对象', '类型', '票数', '单号先付（系统众数）', '还原一致率', '说明']];
    for (const c of missing) {
      const q = check.inferred.get(c.code);
      if (!q) continue;
      const name = d.nameOf('customer', c.code);
      let sheetName = name.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || `客户${c.code}`;
      while (used.has(sheetName)) sheetName = sheetName.slice(0, 26) + '_' + used.size;
      used.add(sheetName);
      const { rows: r, warnings } = quoteToSheetRows(q, { title: `${name}中通快递价格表（按系统实际收费还原，待核对）`, sheetFee: q.sheetFee, note: `${new Date().toLocaleDateString('zh-CN')} 由盈亏透镜根据 ${fmtInt(c.n)} 单系统实收数据还原` });
      sheets.push({ name: sheetName, rows: r, colWidths: [10, 11, 11, 11, 11, 11, 11, 14, 16] });
      const row = rows.find((x) => x.key === c.code);
      index.push([name, row?.type ?? '', c.n, q.sheetFee ?? null, c.checked ? +((c.match + c.system) / c.checked).toFixed(4) : null, warnings.join('；')]);
    }
    downloadXlsx(writeXlsx([{ name: '说明', rows: [['以下客户没有价格表，按系统实际收费还原报价。请与客户核对后再并入价格表。'], [], ...index], colWidths: [24, 10, 9, 14, 12, 80] }, ...sheets]), '补全价格表（系统还原）');
  };
  const assignedCount = book ? Object.keys(book.assign).length : 0;
  // 单票收入不到整体一半的类型（如「无对象」）：收入大多不在本系统结算，会拉低整体利润
  const avgIncome = rows.reduce((a, r) => a + r.income, 0) / Math.max(1, total.n);
  const lowTypes = typeRows.filter((t) => t.income / t.n < avgIncome * 0.5);
  const th = (k: SortKey, label: string, metric?: string) => (
    <th className={`r sortable ${sortKey === k ? 'on' : ''}`} onClick={() => setSortKey(k)} title="点击排序">{label}{metric && <Tip metric={metric} />}{sortKey === k ? ' ▾' : ''}</th>
  );

  return (
    <div className="grid">
      <Card title="全网点客户总览" metric="net" span={2} className="kpi-card" exportName="客户总览" subtitle={`筛选范围内共 ${fmtInt(rows.length)} 个结算对象；纯利按线下成本 ${op.perTicket} 元/票${op.fixedTotal ? ` + 固定 ${op.fixedTotal} 元` : ''} 计算`}>
        <div className="kpis">
          <Kpi label="结算对象" value={fmtInt(rows.length)} sub={`${typeRows.length} 种类型`} />
          <Kpi label="票数" metric="tickets" value={fmtInt(total.n)} />
          <Kpi label="毛利" metric="profit" value={fmtMoney(total.profit)} sub={`单票 ${fmtUnit(total.profit / Math.max(1, total.n))}`} />
          <Kpi label="纯利（估算）" metric="net" value={fmtMoney(total.profit - total.opc)} sub={`单票 ${fmtUnit((total.profit - total.opc) / Math.max(1, total.n))}`} tone={total.profit - total.opc < 0 ? 'neg' : 'pos'} />
          <Kpi label="纯利为负的客户" value={`${lossCust.length} 个`} sub={`涉及 ${fmtInt(lossTickets)} 单（${fmtPct(lossTickets / Math.max(1, total.n))}）`} tone={lossCust.length ? 'neg' : undefined} />
        </div>
        {lowTypes.length > 0 && (
          <p className="warn-text small">
            ⚠ 其中「{lowTypes.map((t) => t.type).join('、')}」共 {fmtInt(lowTypes.reduce((a, t) => a + t.n, 0))} 单，单票收入远低于平均（收入大多不在本系统结算），会拉低整体利润。只看直营客户的真实盈亏时，可在筛选条「结算对象类型」中去掉它们。
          </p>
        )}
      </Card>

      <Card title="按结算对象类型" exportName="结算对象类型" span={2}>
        <table className="tbl compact">
          <thead><tr><th>类型</th><th className="r">客户数</th><th className="r">票数</th><th className="r">占比</th><th className="r">单票收入</th><th className="r">单票毛利</th><th className="r">单票纯利</th><th className="r">总纯利</th></tr></thead>
          <tbody>
            {typeRows.map((t) => (
              <tr key={t.type}>
                <td>{t.type}</td><td className="r num">{t.customers}</td><td className="r num">{fmtInt(t.n)}</td><td className="r num">{fmtPct(t.n / Math.max(1, total.n))}</td>
                <td className="r num">{fmtUnit(t.income / t.n)}</td><td className={`r num ${t.profit < 0 ? 'neg' : ''}`}>{fmtUnit(t.profit / t.n)}</td>
                <td className={`r num ${t.profit - t.opc < 0 ? 'neg' : ''}`}>{fmtUnit((t.profit - t.opc) / t.n)}</td><td className={`r num ${t.profit - t.opc < 0 ? 'neg' : ''}`}>{fmtMoney(t.profit - t.opc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="报价执行核对（全部客户）"
        metric="coverage"
        span={2}
        exportName="多客户报价核对"
        subtitle={
          <>
            有价格表的客户按价格表核对{book ? `（${book.fileName}，已匹配 ${assignedCount} 个结算对象，可在明细表里改）` : ''}；没有价格表的客户以系统实际收费为准，按其收费规律找出异常单。
            <SystemProvinceEditor />
          </>
        }
        actions={
          <>
            <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? '解析中…' : book ? '⤒ 重新上传价格表' : '⤒ 上传价格表'}</button>
            {book && <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'quoteBook', book: null })}>移除</button>}
            <button type="button" className="icon-btn" onClick={exportMissing} disabled={!missing.length} title="把没有价格表的客户按系统实际收费还原成报价，按价格表版式导出，可直接贴进价格表">⤓ 补全价格表（{missing.length}）</button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { void onUpload(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        }
      >
        {err && <p className="error-text">{err}</p>}
        {totalsBy && (
          <div className="kpis">
            <Kpi label="按价格表核对" value={`${totalsBy.sheet.customers} 个客户`} sub={totalsBy.sheet.customers ? `${fmtPct(totalsBy.sheet.n / Math.max(1, total.n))} 票量，一致 ${fmtPct(okRate(totalsBy.sheet), 2)}` : '尚未上传价格表'} />
            <Kpi label="少收（实收 < 价格表）" value={fmtMoney(totalsBy.sheet.underAmt)} sub={`${fmtInt(totalsBy.sheet.under)} 单`} tone={totalsBy.sheet.underAmt > 0.005 ? 'neg' : undefined} />
            <Kpi label="多收（实收 > 价格表）" value={fmtMoney(totalsBy.sheet.overAmt)} sub={`${fmtInt(totalsBy.sheet.over)} 单`} tone={totalsBy.sheet.overAmt > 0.005 ? 'warn' : undefined} />
            <Kpi label="无价格表（以系统为准）" value={`${totalsBy.system.customers} 个客户`} sub={`${fmtPct(totalsBy.system.n / Math.max(1, total.n))} 票量，按系统实收计，不计多收少收`} />
            <Kpi label="收费规律外的单（参考）" value={fmtInt(totalsBy.system.under + totalsBy.system.over)} sub={`无价格表客户中偏离自身收费规律的单，常见原因是中转费未入账`} />
            <Kpi label="以系统为准的省份" value={fmtInt(totalsBy.sheet.system)} sub={`${s.systemProvinces.join('、') || '无'} 与价格表不同的单，不计差异`} />
          </div>
        )}
        {book && book.weak.length > 0 && <p className="warn-text small">⚠ 这些结算对象只按括号里的别名匹配到价格表，请在明细表里确认：{book.weak.join('、')}</p>}
        <p className="muted small">按「少收金额」排序可快速找到报价没有执行到位的客户；点「查看」进入该客户的报价核对页看逐单明细。「补全价格表」把没有价格表的客户按系统实际收费还原，按价格表版式导出，核对后可贴进价格表。</p>
      </Card>

      <Card title="客户纯利排行（票量前 30）" metric="net" exportName="客户纯利排行">
        <Chart option={ranking} height={Math.max(320, Math.min(30, rows.length) * 18 + 30)} />
      </Card>
      <Card title="客户象限：票量 × 单票纯利" metric="unitNet" subtitle="右下 = 量大但亏钱，优先谈价；只显示 100 单以上的客户，纵轴截在 ±2 元" exportName="客户象限">
        <Chart option={quadrant} height={Math.max(320, Math.min(30, rows.length) * 18 + 30)} />
      </Card>

      <Card
        title={`客户明细（${fmtInt(sorted.length)}）`}
        span={2}
        exportName="客户明细"
        actions={
          <>
            <input className="search-input" placeholder="搜索客户" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="icon-btn" onClick={exportTable}>⤓ 导出 Excel</button>
          </>
        }
      >
        <div className="tbl-wrap" style={{ maxHeight: 620 }}>
          <table className="tbl compact sticky cust-tbl">
            <thead>
              <tr>
                <th>结算对象</th><th>类型</th>
                {th('n', '票数')}
                <th className="r">均重</th>
                <th className="r">单票收入</th>
                {th('unitProfit', '单票毛利', 'unitProfit')}
                {th('unitNet', '单票纯利', 'unitNet')}
                {th('net', '总纯利', 'net')}
                <th>核对依据</th>
                {th('match', '一致率', 'coverage')}
                {th('under', '少收金额')}
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const c = check?.byCode.get(r.key);
                const custName = cust.values[r.key];
                const rate = c && c.checked ? (c.match + c.system) / c.checked : NaN;
                return (
                  <tr key={r.key}>
                    <td className="nowrap">{r.name}</td>
                    <td className="muted nowrap">{r.type}</td>
                    <td className="r num">{fmtInt(r.n)}</td>
                    <td className="r num">{fmtKg(r.avgW)}</td>
                    <td className="r num">{fmtUnit(r.unitIncome)}</td>
                    <td className={`r num ${r.unitProfit < 0 ? 'neg' : ''}`}>{fmtUnit(r.unitProfit)}</td>
                    <td className={`r num ${r.unitNet < 0 ? 'neg' : ''}`}>{fmtUnit(r.unitNet)}</td>
                    <td className={`r num ${r.net < 0 ? 'neg' : ''}`}>{fmtMoney(r.net)}</td>
                    <td>
                      {book ? (
                        <select className={`sel sel-sm ${book.weak.includes(custName) ? 'weak' : ''}`} value={book.assign[custName] ?? ''} onChange={(e) => dispatch({ type: 'assign', customer: custName, sheet: e.target.value || null })}>
                          <option value="">系统收费（无价格表）</option>
                          {usableSheets.map((sh) => <option key={sh} value={sh}>{s.anonymize ? '价格表' + (usableSheets.indexOf(sh) + 1) : sh}</option>)}
                        </select>
                      ) : <span className="muted small">系统收费</span>}
                    </td>
                    {c?.source === 'system' ? (
                      <>
                        <td className="r muted small" title={`以系统实收为准；偏离其收费规律的单 ${c.under + c.over} 单（仅供参考）`}>以系统为准</td>
                        <td className="r muted small">{c.under + c.over ? `参考 ${c.under + c.over} 单` : '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className={`r num ${rate < 0.99 ? (rate < 0.9 ? 'cell-bad' : 'cell-warn') : ''}`}>{Number.isFinite(rate) ? fmtPct(rate, rate < 1 && rate > 0.99 ? 2 : 1) : '—'}</td>
                        <td className={`r num ${c && c.underAmt > 0.005 ? 'neg' : ''}`}>{c ? (c.underAmt > 0.005 ? fmtMoney(c.underAmt) : '0') : '—'}</td>
                      </>
                    )}
                    <td className="nowrap"><button type="button" className="link" onClick={() => view(r.key)}>查看 ›</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
