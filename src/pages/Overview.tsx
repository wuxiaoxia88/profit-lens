// 经营总览：核心指标、单票利润瀑布、自动结论、每日趋势、收入成本构成。
import { useCallback, useMemo } from 'react';
import { bandRows, insights, provRows, totalRow } from '../app/analysis';
import { fmtInt, fmtKg, fmtMoney, fmtPct, fmtUnit } from '../app/format';
import { useDerived, useStore } from '../app/store';
import type { Theme } from '../app/theme';
import { Card, Kpi, Empty } from '../components/Card';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { Tip } from '../components/Tip';
import { dayToString } from '../engine/dataset';
import { aggregate, dayKey, type Measure } from '../engine/model';
import { METRICS } from '../engine/metrics';

export function Overview() {
  const d = useDerived()!;
  const { s } = useStore();
  const op = s.opCost;
  const caps = d.model.caps;
  const total = useMemo(() => totalRow(d, op), [d, op]);
  const bands = useMemo(() => bandRows(d, op), [d, op]);
  const provs = useMemo(() => provRows(d, op), [d, op]);
  const tips = useMemo(() => insights(d, op, total, bands, provs), [d, op, total, bands, provs]);
  const agg = useMemo(() => aggregate(d.model, d.mask, null, 1), [d]);
  const opSet = op.perTicket > 0 || op.fixedTotal > 0;

  const comp = (m: Measure) => (agg.sum[m] ? agg.sum[m]![0] / Math.max(1, total.n) : NaN);

  const waterfall = useCallback((t: Theme) => {
    const steps: { name: string; v: number; kind: 'total' | 'delta'; metric?: string }[] = [];
    if (caps.costParts) {
      steps.push({ name: '单票收入', v: total.unitIncome, kind: 'total', metric: 'income' });
      steps.push({ name: '中转成本', v: -comp('cTransfer'), kind: 'delta' });
      steps.push({ name: '派费成本', v: -comp('cDispatch'), kind: 'delta' });
      steps.push({ name: '面单成本', v: -comp('cSheet'), kind: 'delta' });
      if (agg.sum.cVA) steps.push({ name: '增值成本', v: -comp('cVA'), kind: 'delta' });
      if (agg.sum.cPolicy) steps.push({ name: comp('cPolicy') < 0 ? '政策补贴' : '政策扣款', v: -comp('cPolicy'), kind: 'delta' });
    } else {
      steps.push({ name: '单票收入', v: total.unitIncome, kind: 'total' });
      steps.push({ name: '单票成本', v: -total.unitCost, kind: 'delta' });
    }
    steps.push({ name: '单票毛利', v: total.unitProfit, kind: 'total' });
    if (opSet) {
      steps.push({ name: '线下成本', v: -(total.opc / Math.max(1, total.n)), kind: 'delta' });
      steps.push({ name: '单票纯利', v: total.unitNet, kind: 'total' });
    }
    // 每根柱子是一个区间 [lo, hi]；ECharts 正负值分别堆叠，所以跨 0 的柱子拆成正、负两段
    let run = 0;
    const iv = steps.map((st) => {
      if (st.kind === 'total') { run = st.v; return { lo: Math.min(0, st.v), hi: Math.max(0, st.v), cat: 2 }; }
      const from = run, to = run + st.v;
      run = to;
      return { lo: Math.min(from, to), hi: Math.max(from, to), cat: st.v >= 0 ? 0 : 1 };
    });
    const colors = [t.series[0], t.div.neg[1], t.ink2];
    const basePos = iv.map((x) => (x.lo > 0 ? x.lo : 0));
    const baseNeg = iv.map((x) => (x.hi < 0 ? x.hi : 0));
    const label = (pos: boolean) => ({
      show: true,
      position: pos ? 'top' : 'bottom',
      color: t.ink,
      fontSize: 11,
      formatter: (p: { dataIndex: number; value: number }) => {
        const st = steps[p.dataIndex], x = iv[p.dataIndex];
        if (!p.value || (pos ? !(x.hi > 0) : x.hi > 0)) return '';
        return st.kind === 'total' ? st.v.toFixed(3) : (st.v >= 0 ? '+' : '−') + Math.abs(st.v).toFixed(3);
      },
    });
    const catSeries = [0, 1, 2].flatMap((c) => [
      { type: 'bar', stack: 'w', barWidth: '56%', data: iv.map((x) => (x.cat === c ? Math.max(x.hi, 0) - Math.max(x.lo, 0) : 0)), itemStyle: { color: colors[c], borderRadius: 3 }, label: label(true) },
      { type: 'bar', stack: 'w', barWidth: '56%', data: iv.map((x) => (x.cat === c ? Math.min(x.lo, 0) - Math.min(x.hi, 0) : 0)), itemStyle: { color: colors[c], borderRadius: 3 }, label: label(false) },
    ]);
    const o = baseOption(t);
    return {
      ...o,
      legend: { show: false },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const st = steps[ps[0].dataIndex];
        return `<b>${st.name}</b><br/>${st.kind === 'total' ? '' : st.v >= 0 ? '+' : '−'}${Math.abs(st.v).toFixed(3)} 元/票`;
      } },
      xAxis: { type: 'category', data: steps.map((x) => x.name), ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11, interval: 0 } },
      yAxis: { type: 'value', name: '元/票', ...axisStyle(t) },
      series: [
        { type: 'bar', stack: 'w', data: basePos, itemStyle: { color: 'transparent' }, silent: true, barWidth: '56%' },
        { type: 'bar', stack: 'w', data: baseNeg, itemStyle: { color: 'transparent' }, silent: true, barWidth: '56%' },
        ...catSeries,
      ],
    };
  }, [total, caps.costParts, agg, opSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const k = dayKey(d.model);
    if (!k) return null;
    const a = aggregate(d.model, d.mask, k.key, k.K);
    const labels: string[] = [], n: number[] = [], up: number[] = [], un: number[] = [];
    for (let i = 0; i < k.K; i++) {
      if (!a.n[i]) continue;
      const opc = op.perTicket * a.n[i] + (d.count ? (op.fixedTotal * a.n[i]) / d.count : 0);
      labels.push(dayToString(d.model.minDay + i).slice(5));
      n.push(a.n[i]);
      const p = a.sum.profit?.[i] ?? NaN;
      up.push(+(p / a.n[i]).toFixed(4));
      un.push(+((p - opc) / a.n[i]).toFixed(4));
    }
    return labels.length > 1 ? { labels, n, up, un } : null;
  }, [d, op]);

  const dayVolume = useCallback((t: Theme) => {
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmtInt(v) + ' 单' },
      xAxis: { type: 'category', data: days!.labels, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', name: '票数', ...axisStyle(t) },
      series: [{ type: 'bar', name: '票数', data: days!.n, itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 }],
    };
  }, [days]);

  const dayProfit = useCallback((t: Theme) => {
    const o = baseOption(t);
    const series = [{ type: 'line', name: '单票毛利', data: days!.up, symbolSize: 6, lineStyle: { width: 2 }, itemStyle: { color: t.series[0] } }];
    if (opSet) series.push({ type: 'line', name: '单票纯利', data: days!.un, symbolSize: 6, lineStyle: { width: 2 }, itemStyle: { color: t.series[1] } });
    return {
      ...o,
      legend: { ...(o.legend as object), show: opSet },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', valueFormatter: (v: number) => v.toFixed(3) + ' 元' },
      xAxis: { type: 'category', data: days!.labels, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', name: '元/票', ...axisStyle(t) },
      series: series.map((x) => ({ ...x, markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, data: [{ yAxis: 0 }], label: { show: false } } })),
    };
  }, [days, opSet]);

  if (!caps.profit && !caps.income) {
    return (
      <div className="grid">
        <Card title="数据概况" span={2}>
          <div className="kpis">
            <Kpi label="票数" metric="tickets" value={fmtInt(total.n)} />
            {d.model.cols.weight && <Kpi label="平均结算重量" metric="avgWeight" value={fmtKg(total.avgW) + ' kg'} />}
          </div>
          <Empty>这份数据没有收入、成本、利润字段，可使用「结构占比」页分析流向和重量段；补充收入成本字段后可解锁利润分析与报价核对。</Empty>
        </Card>
        <InsightCard items={tips} />
      </div>
    );
  }

  const comps = [
    { group: '收入', items: [['inTransfer', '中转收入'], ['inSheet', '面单收入'], ['inVA', '增值收入']] },
    { group: '成本', items: [['cTransfer', '中转成本'], ['cDispatch', '派费成本'], ['cSheet', '面单成本'], ['cVA', '增值成本'], ['cPolicy', '政策费用']] },
  ] as const;

  return (
    <div className="grid">
      <Card title="核心指标" subtitle="筛选范围内合计；悬停 ⓘ 查看每个数字的计算公式和来源" span={2} className="kpi-card">
        <div className="kpis">
          <Kpi label="票数" metric="tickets" value={fmtInt(total.n)} sub={d.model.cols.weight ? `均重 ${fmtKg(total.avgW)} kg` : undefined} />
          {caps.income && <Kpi label="收入" metric="income" value={fmtMoney(total.income)} sub={`单票 ${fmtUnit(total.unitIncome)}`} />}
          {caps.cost && <Kpi label="成本" metric="cost" value={fmtMoney(total.cost)} sub={`单票 ${fmtUnit(total.unitCost)}`} />}
          {caps.profit && <Kpi label="毛利" metric="profit" value={fmtMoney(total.profit)} sub={`单票 ${fmtUnit(total.unitProfit)} · 毛利率 ${fmtPct(total.margin)}`} tone={total.profit < 0 ? 'neg' : undefined} />}
          {caps.profit && <Kpi label="线下成本" metric="opCost" value={opSet ? fmtMoney(total.opc) : '未设置'} sub={opSet ? `单票 ${fmtUnit(total.opc / Math.max(1, total.n))}` : '在顶部提示条中设置'} tone={opSet ? undefined : 'warn'} />}
          {caps.profit && <Kpi label="纯利（估算）" metric="net" value={opSet ? fmtMoney(total.net) : '—'} sub={opSet ? `单票 ${fmtUnit(total.unitNet)}` : '设置线下成本后显示'} tone={opSet ? (total.net < 0 ? 'neg' : 'pos') : undefined} />}
          {caps.profit && <Kpi label="亏损票占比" metric="lossShare" value={fmtPct(total.lossN / Math.max(1, total.n))} sub={`${fmtInt(total.lossN)} 单毛利 < 0`} />}
        </div>
      </Card>

      {caps.profit && caps.income && (
        <Card title="单票利润拆解" metric="unitProfit" subtitle="一票货的钱从哪里来、花到哪里去（元/票）" exportName="单票利润拆解">
          <Chart option={waterfall} height={300} />
        </Card>
      )}

      <InsightCard items={tips} />

      {days && (
        <Card title="每日票量" metric="tickets" exportName="每日票量">
          <Chart option={dayVolume} height={220} />
        </Card>
      )}
      {days && caps.profit && (
        <Card title={opSet ? '每日单票毛利与纯利' : '每日单票毛利'} metric={opSet ? 'unitNet' : 'unitProfit'} exportName="每日单票利润">
          <Chart option={dayProfit} height={220} />
        </Card>
      )}

      {(caps.incomeParts || caps.costParts) && (
        <Card title="收入与成本构成" subtitle="每项的合计、单票金额与占比" span={2} exportName="收入与成本构成">
          <div className="comp-tables">
            {comps.map((g) => {
              const items = g.items.filter(([k]) => agg.sum[k]);
              if (!items.length) return null;
              const base = g.group === '收入' ? total.income : total.cost;
              return (
                <table key={g.group} className="tbl">
                  <thead><tr><th>{g.group}项目</th><th className="r">合计（元）</th><th className="r">单票</th><th className="r">占{g.group}</th></tr></thead>
                  <tbody>
                    {items.map(([k, label]) => {
                      const v = agg.sum[k]![0];
                      return (
                        <tr key={k}>
                          <td>{label}<Tip metric={k} /></td>
                          <td className="r num">{fmtMoney(v)}</td>
                          <td className="r num">{fmtUnit(v / Math.max(1, total.n))}</td>
                          <td className="r num">{fmtPct(v / base)}</td>
                        </tr>
                      );
                    })}
                    <tr className="sum"><td>{g.group}合计</td><td className="r num">{fmtMoney(base)}</td><td className="r num">{fmtUnit(base / Math.max(1, total.n))}</td><td className="r num">100%</td></tr>
                  </tbody>
                </table>
              );
            })}
          </div>
          <p className="muted small">{METRICS.cPolicy.note}</p>
        </Card>
      )}
    </div>
  );
}

function InsightCard({ items }: { items: { tone: string; text: string }[] }) {
  return (
    <Card title="自动结论" subtitle="根据当前筛选自动生成，帮你快速抓住重点" exportName="自动结论">
      <ul className="insights">
        {items.map((x, i) => (
          <li key={i} className={`ins-${x.tone}`}>
            <span className="ins-dot" aria-hidden>{x.tone === 'neg' ? '▼' : x.tone === 'pos' ? '▲' : '●'}</span>
            {x.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
