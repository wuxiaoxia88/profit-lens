// 调价模拟：在报价表上直接改价，即时测算毛利、纯利变化；并按「成本 + 目标利润」给出参考报价。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadXlsx } from '../app/exporter';
import { fmtInt, fmtMoney, fmtPct, fmtPrice, fmtUnit } from '../app/format';
import { useDerived, useInference, useStore } from '../app/store';
import type { Theme } from '../app/theme';
import { Card, Empty, Kpi, Seg } from '../components/Card';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { Tip } from '../components/Tip';
import { bandLabels } from '../engine/bands';
import { opCostFor } from '../engine/model';
import { simulateQuote, type SimCell } from '../engine/quote/check';
import { quoteToRows, TEMPLATE_GUIDE } from '../engine/quote/template';
import { ROUNDING_LABEL, round2, type Quote, type Rounding } from '../engine/quote/types';
import { writeXlsx } from '../engine/xlsxWriter';

function PriceInput({ value, onChange, hint }: { value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return (
    <input
      className="price-input"
      inputMode="decimal"
      value={text}
      title={hint}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        if (t === '') onChange(null);
        else if (Number.isFinite(Number(t))) onChange(Number(t));
      }}
    />
  );
}

export function SimPage() {
  const d = useDerived()!;
  const inf = useInference();
  const { s, dispatch } = useStore();
  const base = inf?.result?.quote ?? null;
  const q = s.simQuote ?? base;
  const mask = inf?.mask ?? d.mask;
  const op = s.opCost;
  const opSet = op.perTicket > 0 || op.fixedTotal > 0;
  const [target, setTarget] = useState(0.2);
  const [targetMode, setTargetMode] = useState<'unit' | 'margin'>('unit');
  const [delta, setDelta] = useState(0.1);

  const after = useMemo(() => (q ? simulateQuote(d.model, q, mask, base ?? undefined) : null), [q, d.model, mask, base]);

  const update = useCallback((fn: (q: Quote) => void) => {
    if (!q) return;
    const next = structuredClone(q);
    next.origin = 'manual';
    fn(next);
    dispatch({ type: 'simQuote', quote: next });
  }, [q, dispatch]);

  if (!d.model.caps.quote || !d.model.caps.profit) {
    return <div className="grid"><Card title="调价模拟" span={2}><Empty>需要运费、收入、成本字段才能做调价模拟。</Empty></Card></div>;
  }
  if (!q || !after) return <div className="grid"><Card title="调价模拟" span={2}><Empty>{inf?.error ?? '暂无可用报价'}</Empty></Card></div>;

  const totalN = after.total.n;
  const opTotal = opCostFor(op, totalN, totalN);
  const oldNet = after.total.profit - opTotal;
  const newNet = after.total.newProfit - opTotal;
  const dP = after.total.newProfit - after.total.profit;
  const labels = bandLabels(q.breakpoints);
  const B = q.breakpoints.length;
  const changed = s.simQuote !== null && JSON.stringify(s.simQuote.zones.map((z) => [z.prices, z.tail])) !== JSON.stringify(base?.zones.map((z) => [z.prices, z.tail]));

  /** 参考价 = 单票成本 − 单票增值收入 + 单票线下成本 + 目标利润（或按目标毛利率反推） */
  const suggest = (c: SimCell): number => {
    if (!c.n) return NaN;
    const unitCost = (c.cost - c.va) / c.n + opCostFor(op, 1, totalN);
    const v = targetMode === 'unit' ? unitCost + target : unitCost / Math.max(0.01, 1 - target / 100);
    return Math.ceil(v * 10 - 1e-9) / 10;
  };

  const applySuggest = () => update((nq) => {
    nq.zones.forEach((z, zi) => {
      z.prices = z.prices.map((p, b) => {
        const c = after.cells[zi][b];
        return c.n >= 10 ? suggest(c) : p;
      });
    });
  });

  const shiftAll = (v: number) => update((nq) => nq.zones.forEach((z) => {
    z.prices = z.prices.map((p) => (p === null ? null : round2(p + v)));
    if (z.tail) z.tail.base = round2(z.tail.base + v);
  }));

  const zoneDelta = (t: Theme) => {
    const rows = q.zones.map((z, zi) => {
      const cs = after.cells[zi];
      return { name: z.name, d: cs.reduce((a, c) => a + c.newProfit - c.profit, 0) };
    });
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' 元' },
      xAxis: { type: 'value', ...axisStyle(t), name: '元' },
      yAxis: { type: 'category', data: rows.map((r) => r.name), inverse: true, ...axisStyle(t), splitLine: { show: false } },
      series: [{ type: 'bar', data: rows.map((r) => +r.d.toFixed(2)), barMaxWidth: 16, itemStyle: { color: (p: { value: number }) => (p.value < 0 ? t.div.neg[1] : t.series[0]), borderRadius: 3 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => (p.value >= 0 ? '+' : '') + fmtMoney(p.value, 0) } }],
    };
  };

  const exportQuote = () => {
    downloadXlsx(writeXlsx([
      { name: '报价', rows: quoteToRows(q), colWidths: [8, 60, ...q.breakpoints.map(() => 10), 12, 12, 14, 12] },
      { name: '填写说明', rows: TEMPLATE_GUIDE, colWidths: [120] },
    ]), '调整后报价');
  };

  return (
    <div className="grid">
      <Card title="调价效果" metric="profit" span={2} className="kpi-card" exportName="调价效果"
        subtitle={`基于${inf?.periodIdx !== null && inf?.periods.length ? `价格时段 ${inf.periods[inf.periodIdx!].label}` : '当前筛选范围'}的 ${fmtInt(totalN)} 单回测：每单运费按「新报价 − 原报价」调整，成本、增值收入不变；报价未覆盖的单按原价计。`}>
        <div className="kpis">
          <Kpi label="原毛利" metric="profit" value={fmtMoney(after.total.profit)} sub={`单票 ${fmtUnit(after.total.profit / Math.max(1, totalN))}`} />
          <Kpi label="调价后毛利" value={fmtMoney(after.total.newProfit)} sub={`单票 ${fmtUnit(after.total.newProfit / Math.max(1, totalN))}`} tone={after.total.newProfit < 0 ? 'neg' : 'pos'} />
          <Kpi label="毛利变化" value={(dP >= 0 ? '+' : '') + fmtMoney(dP)} sub={`单票 ${(dP >= 0 ? '+' : '') + fmtUnit(dP / Math.max(1, totalN))}`} tone={dP < 0 ? 'neg' : dP > 0 ? 'pos' : undefined} />
          <Kpi label="调价后纯利" metric="net" value={opSet ? fmtMoney(newNet) : '—'} sub={opSet ? `原 ${fmtMoney(oldNet)}` : '设置线下成本后显示'} tone={opSet ? (newNet < 0 ? 'neg' : 'pos') : 'warn'} />
          <Kpi label="客户运费变化" value={fmtPct((after.total.newPrice - after.total.oldPrice) / Math.max(1e-9, after.total.oldPrice), 2)} sub={`平均运费 ${fmtUnit(after.total.oldPrice / Math.max(1, totalN))} → ${fmtUnit(after.total.newPrice / Math.max(1, totalN))}`} />
        </div>
      </Card>

      <Card
        title="编辑报价"
        span={2}
        exportName="调价报价表"
        subtitle="直接修改价格，结果实时刷新。格子下方小字：票数 · 单票成本（不含增值）· 参考价。"
        actions={
          <>
            <span className="inline-tools">
              全部
              <input className="price-input" style={{ width: 56 }} value={delta} onChange={(e) => setDelta(Number(e.target.value) || 0)} />元
              <button type="button" className="icon-btn" onClick={() => shiftAll(delta)}>加价</button>
              <button type="button" className="icon-btn" onClick={() => shiftAll(-delta)}>降价</button>
            </span>
            <button type="button" className="icon-btn" onClick={exportQuote}>⤓ 导出报价</button>
            <button type="button" className="icon-btn" disabled={!changed} onClick={() => dispatch({ type: 'simQuote', quote: null })}>还原</button>
          </>
        }
      >
        <div className="suggest-bar">
          <span>参考价 = 单票成本 + 线下成本 +</span>
          <Seg size="sm" value={targetMode} onChange={setTargetMode} options={[{ value: 'unit', label: '目标单票利润' }, { value: 'margin', label: '目标毛利率' }]} />
          <input className="price-input" value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} style={{ width: 64 }} />
          <span>{targetMode === 'unit' ? '元/票' : '%'}</span>
          <Tip>
            <div className="tip-title">参考价（成本加成报价）</div>
            <div className="tip-row"><span>计算</span>（该分区该重量段的单票成本 − 单票增值收入）+ 单票线下成本 + 目标利润，向上取到 0.1 元</div>
            <div className="tip-note">成本来自历史实际发生的单票成本均值。样本少于 10 单的格子不给参考价。这是快速报价的起点，正式报价请结合市场价格与客户谈判空间。</div>
          </Tip>
          <button type="button" className="icon-btn" onClick={applySuggest}>按参考价填入</button>
          {!opSet && <span className="warn-text small">未设置线下成本，参考价会偏低</span>}
        </div>
        <div className="tbl-wrap">
          <table className="tbl sim-tbl">
            <thead>
              <tr>
                <th>分区</th>
                {labels.slice(0, B).map((l) => <th key={l} className="r">{l}kg</th>)}
                <th>续重（基价 + 单价 × 取整）</th>
                <th className="r">毛利变化</th>
              </tr>
            </thead>
            <tbody>
              {q.zones.map((z, zi) => {
                const cs = after.cells[zi];
                const dz = cs.reduce((a, c) => a + c.newProfit - c.profit, 0);
                return (
                  <tr key={z.id}>
                    <td className="nowrap" title={z.provinces.join('、')}><b>{z.name}</b><div className="muted small ellipsis">{z.provinces.slice(0, 4).join('、')}{z.provinces.length > 4 ? ` 等${z.provinces.length}省` : ''}</div></td>
                    {z.prices.map((p, b) => {
                      const c = cs[b];
                      const sg = suggest(c);
                      const old = base?.zones[zi]?.prices[b];
                      return (
                        <td key={b} className="r">
                          <PriceInput value={p} onChange={(v) => update((nq) => { nq.zones[zi].prices[b] = v; })} />
                          {old !== undefined && old !== p && <div className="small muted">原 {fmtPrice(old)}</div>}
                          {c.n > 0 && (
                            <div className="cell-meta">
                              {fmtInt(c.n)}单 · 本{fmtUnit((c.cost - c.va) / c.n)}
                              {c.n >= 10 && <> · <button type="button" className="link" title="填入参考价" onClick={() => update((nq) => { nq.zones[zi].prices[b] = sg; })}>参{fmtPrice(sg)}</button></>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      {z.tail ? (
                        <div className="tail-edit">
                          &gt;<PriceInput value={z.tail.start} onChange={(v) => v !== null && update((nq) => { nq.zones[zi].tail!.start = v; })} />kg：
                          <PriceInput value={z.tail.base} onChange={(v) => v !== null && update((nq) => { nq.zones[zi].tail!.base = v; })} /> +
                          <PriceInput value={z.tail.perKg} onChange={(v) => v !== null && update((nq) => { nq.zones[zi].tail!.perKg = v; })} />×
                          <select value={z.tail.rounding} onChange={(e) => update((nq) => { nq.zones[zi].tail!.rounding = e.target.value as Rounding; })}>
                            {Object.entries(ROUNDING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <div className="cell-meta">{fmtInt(cs[B].n)} 单超出 {q.breakpoints[B - 1]}kg</div>
                        </div>
                      ) : (
                        <button type="button" className="link" onClick={() => update((nq) => { nq.zones[zi].tail = { start: nq.breakpoints[B - 1], base: (nq.zones[zi].prices[B - 1] ?? 0) + 1, perKg: 1, rounding: 'ceil' }; })}>＋ 添加续重规则</button>
                      )}
                    </td>
                    <td className={`r num ${dz < 0 ? 'neg' : dz > 0 ? 'pos' : ''}`}>{dz ? (dz > 0 ? '+' : '') + fmtMoney(dz) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="各分区毛利变化" metric="profit" exportName="分区毛利变化">
        <Chart option={zoneDelta} height={Math.max(200, q.zones.length * 30 + 30)} />
      </Card>
      <Card title="使用提示" exportName="调价提示">
        <ul className="insights">
          <li className="ins-info"><span className="ins-dot">●</span>先在「报价还原与核对」确认报价无误，再来这里改价。</li>
          <li className="ins-info"><span className="ins-dot">●</span>调价模拟假设客户货量结构不变；涨价后货量可能流失，请结合客户实际判断。</li>
          <li className="ins-info"><span className="ins-dot">●</span>「参考价」基于历史成本：适合给同类新客户快速报价，或判断现有报价哪个格子低于成本。</li>
          <li className="ins-info"><span className="ins-dot">●</span>改好的报价可「导出报价」保存为 Excel，下次在核对页上传即可继续使用。</li>
        </ul>
      </Card>
    </div>
  );
}
