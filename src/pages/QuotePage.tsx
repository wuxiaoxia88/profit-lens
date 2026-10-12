// 报价还原与核对：从运费反推报价 → 下载模板 / 上传正式报价 → 逐单核对，找出多收、少收、无报价的单。
import { useMemo, useRef, useState } from 'react';
import { downloadXlsx } from '../app/exporter';
import { fmtInt, fmtKg, fmtMoney, fmtPct, fmtPrice } from '../app/format';
import { useDerived, useInference, useStore } from '../app/store';
import { Card, Empty, Kpi, Seg } from '../components/Card';
import { QuoteTable } from '../components/QuoteTable';
import { Tip } from '../components/Tip';
import { bandLabels } from '../engine/bands';
import { dayToString, waybillAt } from '../engine/dataset';
import { readTable } from '../engine/load';
import { METRICS } from '../engine/metrics';
import { checkQuote, CheckStatus, STATUS_LABEL } from '../engine/quote/check';
import { attachStats } from '../engine/quote/infer';
import { quoteToRows, rowsToQuote, TEMPLATE_GUIDE } from '../engine/quote/template';
import type { Quote } from '../engine/quote/types';
import { writeXlsx, type Cell } from '../engine/xlsxWriter';
import { sheetOf } from '../app/book';
import { quoteToSheetRows } from '../engine/quote/sheetExport';
import { SystemProvinceEditor } from '../components/SystemProvinceEditor';
import { NO_DATE, stringToDay } from '../engine/dataset';
import { ProvinceNoteList } from '../components/ProvinceNotes';

const BASIS_TEXT = { 'sheet+transfer': '面单收入 + 中转收入', 'income-va': '收入 − 增值收入', income: '收入' } as const;

export function QuotePage() {
  const d = useDerived()!;
  const inf = useInference();
  const { s, dispatch } = useStore();
  const [targetPref, setTarget] = useState<'inferred' | 'uploaded' | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 筛选范围内有哪些结算对象：报价是按客户定的，多个客户混在一起无法还原
  const custList = useMemo(() => {
    const col = d.model.data.dict.customer;
    if (!col) return [];
    const cnt = new Float64Array(col.values.length);
    for (let i = 0; i < d.model.n; i++) if (d.mask[i]) cnt[col.codes[i]]++;
    return col.values.map((_, c) => ({ code: c, n: cnt[c] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  }, [d]);
  const single = custList.length === 1 ? custList[0] : null;
  const bookSheet = single ? sheetOf(s.quoteBook, d.model.data.dict.customer!.values[single.code]) : undefined;

  const inferred = inf?.result?.quote ?? null;
  const uploaded = s.uploadedQuote ?? bookSheet?.quote ?? null;
  const uploadedLabel = s.uploadedQuote ? '上传的报价' : bookSheet ? `价格表「${s.anonymize ? '本客户' : bookSheet.sheet}」` : '';
  const target = targetPref ?? (uploaded ? 'uploaded' : 'inferred');
  const active: Quote | null = target === 'uploaded' && uploaded ? uploaded : inferred;
  // 价格表有生效日期时，只核对生效日之后的单；否则沿用识别出的最新价格时段
  const uploadedMask = useMemo(() => {
    const from = !s.uploadedQuote && bookSheet?.effectiveFrom ? stringToDay(bookSheet.effectiveFrom) : NO_DATE;
    if (from === NO_DATE || !d.model.day) return inf?.mask ?? d.mask;
    const out = new Uint8Array(d.model.n);
    for (let i = 0; i < d.model.n; i++) out[i] = d.mask[i] && d.model.day[i] >= from ? 1 : 0;
    return out;
  }, [s.uploadedQuote, bookSheet, d, inf]);
  const checkMask = target === 'uploaded' && uploaded ? uploadedMask : inf?.mask ?? d.mask;

  // 上传的报价也要算各分区覆盖率
  const uploadedWithStats = useMemo(() => {
    if (!uploaded) return null;
    const q = structuredClone(uploaded);
    attachStats(d.model, uploadedMask, q, s.systemProvinces);
    return q;
  }, [uploaded, d.model, uploadedMask, s.systemProvinces]);
  const activeQ = target === 'uploaded' && uploadedWithStats ? uploadedWithStats : active;

  const check = useMemo(() => (activeQ ? checkQuote(d.model, activeQ, checkMask, s.systemProvinces) : null), [activeQ, d.model, checkMask, s.systemProvinces]);

  const exceptions = useMemo(() => {
    if (!check) return [];
    const idx: number[] = [];
    for (let i = 0; i < d.model.n; i++) if (check.status[i] === CheckStatus.Over || check.status[i] === CheckStatus.Under || check.status[i] === CheckStatus.NoQuote) idx.push(i);
    const price = d.model.cols.price!;
    // 先列价格不符（按差额绝对值从大到小），再列无报价
    const diff = (i: number) => (Number.isFinite(check.expected[i]) ? Math.abs(price[i] - check.expected[i]) : -1);
    idx.sort((a, b) => diff(b) - diff(a));
    return idx;
  }, [check, d.model]);

  if (!d.model.caps.quote) {
    return <div className="grid"><Card title="报价还原与核对" span={2}><Empty>需要「目的地」「结算重量」以及「面单收入/中转收入」或「收入」字段才能还原报价。</Empty></Card></div>;
  }
  if (custList.length > 1) {
    const col = d.model.data.dict.customer!;
    return (
      <div className="grid">
        <Card title="请先选择一个结算对象" span={2}>
          <p>当前筛选范围内有 <b>{custList.length}</b> 个结算对象。每个客户的报价不同，混在一起无法还原和核对报价。</p>
          <div className="pick-row">
            <select className="sel" defaultValue="" onChange={(e) => e.target.value !== '' && dispatch({ type: 'filters', filters: { ...s.filters, customers: new Set([Number(e.target.value)]) } })}>
              <option value="" disabled>选择结算对象…</option>
              {custList.slice(0, 300).map((c) => <option key={c.code} value={c.code}>{d.nameOf('customer', c.code)}（{fmtInt(c.n)} 单）{sheetOf(s.quoteBook, col.values[c.code]) ? ' ✓有价格表' : ''}</option>)}
            </select>
            <button type="button" className="link" onClick={() => dispatch({ type: 'tab', tab: 'customers' })}>或到「客户总览」一次核对所有客户 ›</button>
          </div>
        </Card>
      </div>
    );
  }

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    setUploadErr(null);
    try {
      const rows = await readTable(f, f.name);
      const q = rowsToQuote(rows, f.name.replace(/\.[^.]+$/, ''), d.model.priceBasis);
      dispatch({ type: 'uploadedQuote', quote: q });
      setTarget('uploaded');
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadTemplate = () => {
    if (!inferred) return;
    const rows = quoteToRows(inferred);
    downloadXlsx(writeXlsx([
      { name: '报价', rows, colWidths: [8, 60, ...inferred.breakpoints.map(() => 10), 12, 12, 14, 12] },
      { name: '填写说明', rows: TEMPLATE_GUIDE, colWidths: [120] },
    ]), '客户报价模板');
  };

  const exportSheetLayout = () => {
    if (!inferred) return;
    const name = single ? d.nameOf('customer', single.code) : '客户';
    const { rows, warnings } = quoteToSheetRows(inferred, { title: `${name}中通快递价格表（按系统实际收费还原，待核对）`, sheetFee: inferred.sheetFee, note: `${new Date().toLocaleDateString('zh-CN')} 由盈亏透镜根据系统实收数据还原` });
    if (warnings.length) rows.push([], ...warnings.map((w) => ['⚠ ' + w]));
    downloadXlsx(writeXlsx([{ name: name.slice(0, 28), rows, colWidths: [10, 11, 11, 11, 11, 11, 11, 14, 16] }]), `${name}价格表（系统还原）`);
  };

  const exportExceptions = () => {
    if (!check) return;
    const price = d.model.cols.price!, w = d.model.cols.weight!;
    const acc = d.model.data.dict.account, ret = d.model.data.dict.returned, day = d.model.day;
    const labels = bandLabels(activeQ!.breakpoints);
    const head: Cell[] = ['运单号', '揽收日期', '面单账号', '目的地', '结算重量', '重量段', '分区', '实收运费', '按报价应收', '差额（实收−应收）', '状态', '退件'];
    const rows: Cell[][] = [head];
    for (const i of exceptions) {
      const e = check.expected[i];
      const z = check.zones[i];
      rows.push([
        waybillAt(d.model.data, i), day ? dayToString(day[i]) : '', acc ? d.nameOf('account', acc.codes[i]) : '', d.model.provNames[d.model.prov[i]], w[i], labels[check.bands[i]],
        z >= 0 ? activeQ!.zones[z].name : '未覆盖', price[i], Number.isFinite(e) ? e : null, Number.isFinite(e) ? +(price[i] - e).toFixed(3) : null,
        STATUS_LABEL[check.status[i]], ret ? ret.values[ret.codes[i]] : '',
      ]);
    }
    downloadXlsx(writeXlsx([{ name: '报价差异清单', rows, colWidths: [18, 12, 18, 8, 9, 9, 8, 9, 10, 14, 8, 6] }]), '报价差异清单');
  };

  const periods = inf?.periods ?? [];
  const t = check?.total;
  const labels = activeQ ? bandLabels(activeQ.breakpoints) : [];

  return (
    <div className="grid">
      {periods.length > 1 && (
        <div className="notice span-2">
          <b>检测到客户在筛选范围内调过价</b>：数据被分成 {periods.length} 个价格时段，报价按时段分别还原。当前查看：
          <Seg
            size="sm"
            value={String(inf!.periodIdx)}
            onChange={(v) => dispatch({ type: 'period', idx: Number(v) })}
            options={periods.map((p, i) => ({ value: String(i), label: `${p.label}（${fmtInt(p.tickets)} 单）` }))}
          />
          <Tip>
            <div className="tip-title">调价识别</div>
            <div className="tip-note">每天取票量最大的几个省份 1kg 以内的众数运费作为「价格指纹」，连续两天指纹变化即判定为调价。各时段指纹：</div>
            {periods.map((p) => <div key={p.label} className="tip-row"><span>{p.label}</span>{Object.entries(p.signature).map(([k, v]) => `${k} ${v}`).join('，')}</div>)}
          </Tip>
        </div>
      )}

      <Card
        title="系统还原的报价（以系统实际收费为准）"
        metric="price"
        span={2}
        exportName="系统还原报价"
        subtitle={
          inferred ? (
            <>
              按运费口径「{BASIS_TEXT[inferred.basis]}」反推{inferred.sheetFee ? `，其中固定面单费 ${inferred.sheetFee} 元` : ''}。
              覆盖率 <b>{fmtPct(inf!.result!.coverage, 2)}</b>：这么多单的运费能被下表完全解释，其余是例外单（见下方核对）。
            </>
          ) : inf?.error
        }
        actions={
          <>
            <button type="button" className="icon-btn" onClick={exportSheetLayout} disabled={!inferred} title="按网点价格表的版式导出，可直接贴进价格表">⤓ 价格表版式</button>
            <button type="button" className="icon-btn" onClick={downloadTemplate} disabled={!inferred}>⤓ 报价模板</button>
            <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()}>⤒ 上传报价</button>
            <button type="button" className="icon-btn" disabled={!inferred} onClick={() => { dispatch({ type: 'simQuote', quote: structuredClone(target === 'uploaded' && uploaded ? uploaded : inferred!) }); dispatch({ type: 'tab', tab: 'sim' }); }}>✎ 调价模拟</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { void onUpload(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        }
      >
        {inferred ? <QuoteTable q={inferred} /> : <Empty>{inf?.error ?? '无法还原报价'}</Empty>}
        {inf?.result?.notes.map((n) => <p key={n} className="muted small">⚠ {n}</p>)}
        {uploadErr && <p className="error-text">上传失败：{uploadErr}</p>}
        <p className="muted small">
          怎么用：① 点「报价模板」下载，模板已按上表预填；② 对照客户正式报价单修改；③ 点「上传报价」，系统逐单核对应收与实收。
        </p>
      </Card>

      {uploadedWithStats && (
        <Card
          title={s.uploadedQuote ? `上传的报价：${uploadedWithStats.name}` : `${uploadedLabel}（自动匹配）`}
          span={2}
          exportName="客户报价"
          subtitle={!s.uploadedQuote && bookSheet ? [bookSheet.effectiveFrom && `${bookSheet.effectiveFrom} 起实施`, bookSheet.sheetFee !== undefined && `单号先付 ${bookSheet.sheetFee} 元/单`, '价格已含北京、上海等加收'].filter(Boolean).join('；') : undefined}
          actions={s.uploadedQuote ? <button type="button" className="icon-btn" onClick={() => { dispatch({ type: 'uploadedQuote', quote: null }); setTarget(null); }}>移除</button> : undefined}
        >
          <QuoteTable q={uploadedWithStats} />
          {!s.uploadedQuote && bookSheet && (bookSheet.warnings.length > 0 || bookSheet.specialAreas.length > 0) && (
            <div className="sheet-notes">
              {bookSheet.specialAreas.length > 0 && <p className="small"><b>报价单里的地市特价（未单独核对，相关单会显示为多收/少收）：</b>{bookSheet.specialAreas.join('；')}</p>}
              {bookSheet.warnings.map((w) => <p key={w} className="warn-text small">⚠ {w}</p>)}
            </div>
          )}
          {!s.uploadedQuote && bookSheet && bookSheet.notes.length > 0 && (
            <details className="small muted"><summary>报价单原文备注</summary>{bookSheet.notes.map((n, k) => <p key={k}>{n}</p>)}</details>
          )}
        </Card>
      )}
      <ProvinceNoteList />

      {check && t && (
        <Card
          title="逐单核对结果"
          metric="coverage"
          span={2}
          exportName="报价核对结果"
          subtitle={<>{`核对对象：${target === 'uploaded' && uploaded ? uploadedLabel : '系统还原的报价'}${target === 'uploaded' && bookSheet?.effectiveFrom && !s.uploadedQuote ? `（${bookSheet.effectiveFrom} 起生效，之前的单不参与）` : ''}；${METRICS.price.note}`}<SystemProvinceEditor /></>}
          actions={uploaded ? <Seg size="sm" value={target} onChange={setTarget} options={[{ value: 'inferred', label: '对照还原报价' }, { value: 'uploaded', label: s.uploadedQuote ? '对照上传报价' : '对照价格表' }]} /> : undefined}
        >
          <div className="kpis">
            <Kpi label="参与核对" value={fmtInt(t.n)} sub="重量、运费都大于 0 的单" />
            <Kpi label="一致率" metric="coverage" value={fmtPct((t.match + t.system) / Math.max(1, t.n), 2)} sub={`${fmtInt(t.match)} 单与报价一致${t.system ? `，${fmtInt(t.system)} 单以系统为准` : ''}`} tone={(t.match + t.system) / Math.max(1, t.n) < 0.99 ? 'warn' : 'pos'} />
            <Kpi label="多收" value={fmtInt(t.over)} sub="实收高于报价" tone={t.over ? 'warn' : undefined} />
            <Kpi label="少收" value={fmtInt(t.under)} sub="实收低于报价，直接损失" tone={t.under ? 'neg' : undefined} />
            <Kpi label="无报价" value={fmtInt(t.noQuote)} sub="报价未覆盖的省份/重量" tone={t.noQuote ? 'warn' : undefined} />
            {t.system > 0 && <Kpi label="以系统为准" value={fmtInt(t.system)} sub={`${s.systemProvinces.join('、')} 与报价不同，不计差异`} />}
            <Kpi label="差额合计" metric="diff" value={fmtMoney(t.diff)} sub="正 = 多收，负 = 少收" tone={t.diff < -0.005 ? 'neg' : undefined} />
          </div>
          <div className="tbl-wrap">
            <table className="tbl compact match-tbl">
              <thead><tr><th>分区 \ 重量段</th>{labels.map((l) => <th key={l} className="r">{l}kg</th>)}</tr></thead>
              <tbody>
                {check.cells.map((row, zi) => {
                  if (!row.some((c) => c.n)) return null;
                  const name = zi < activeQ!.zones.length ? activeQ!.zones[zi].name : '未覆盖省份';
                  return (
                    <tr key={zi}>
                      <td className="nowrap"><b>{name}</b></td>
                      {row.map((c, b) => {
                        if (!c.n) return <td key={b} className="r muted">—</td>;
                        const rate = (c.match + c.system) / c.n;
                        return (
                          <td key={b} className={`r num ${rate < 1 ? (rate < 0.95 ? 'cell-bad' : 'cell-warn') : ''}`} title={`${fmtInt(c.n)} 单：一致 ${c.match}，以系统为准 ${c.system}，多收 ${c.over}，少收 ${c.under}，无报价 ${c.noQuote}；差额 ${c.diff.toFixed(2)} 元`}>
                            {fmtPct(rate, rate < 1 && rate > 0.99 ? 2 : 0)}<small> / {fmtInt(c.n)}</small>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">格子 = 一致率 / 票数；橙色 = 有少量例外，红色 = 一致率低于 95%。悬停格子查看明细。</p>
        </Card>
      )}

      {check && (
        <Card
          title={`例外单（${fmtInt(exceptions.length)} 单）`}
          span={2}
          exportName="报价例外单"
          subtitle="先列价格不符（按差额从大到小），再列无报价；最多显示 200 单，完整清单请导出 Excel"
          actions={<button type="button" className="icon-btn" onClick={exportExceptions} disabled={!exceptions.length}>⤓ 导出差异清单</button>}
        >
          {exceptions.length ? (
            <div className="tbl-wrap" style={{ maxHeight: 460 }}>
              <table className="tbl compact sticky">
                <thead><tr><th>运单号</th><th>揽收日期</th><th>面单账号</th><th>目的地</th><th className="r">重量</th><th className="r">实收</th><th className="r">应收</th><th className="r">差额</th><th>状态</th><th>退件</th></tr></thead>
                <tbody>
                  {exceptions.slice(0, 200).map((i) => {
                    const e = check.expected[i];
                    const p = d.model.cols.price![i];
                    const st = check.status[i];
                    return (
                      <tr key={i}>
                        <td className="mono">{waybillAt(d.model.data, i)}</td>
                        <td>{d.model.day ? dayToString(d.model.day[i]) : ''}</td>
                        <td>{d.model.data.dict.account ? d.nameOf('account', d.model.data.dict.account.codes[i]) : ''}</td>
                        <td>{d.model.provNames[d.model.prov[i]]}</td>
                        <td className="r num">{fmtKg(d.model.cols.weight![i])}</td>
                        <td className="r num">{fmtPrice(p)}</td>
                        <td className="r num">{fmtPrice(e)}</td>
                        <td className={`r num ${st === CheckStatus.Under ? 'neg' : ''}`}>{Number.isFinite(e) ? (p - e > 0 ? '+' : '') + (p - e).toFixed(2) : '—'}</td>
                        <td><span className={`badge b-${st}`}>{STATUS_LABEL[st]}</span></td>
                        <td>{d.model.data.dict.returned ? d.model.data.dict.returned.values[d.model.data.dict.returned.codes[i]] : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>所有单的运费都与报价一致。</Empty>
          )}
        </Card>
      )}
    </div>
  );
}
