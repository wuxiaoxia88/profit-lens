// 流向 × 重量段利润：热力矩阵、重量段收支、省份排行、0.1kg 利润曲线、票量-利润象限。
import { useCallback, useMemo, useState } from 'react';
import { bandRows, matrixRows, provRows, type GroupRow } from '../app/analysis';
import { downloadXlsx } from '../app/exporter';
import { fmtInt, fmtMoney, fmtPct, fmtUnit } from '../app/format';
import { useDerived, useStore } from '../app/store';
import { divergingColors, type Theme } from '../app/theme';
import { Card, Seg } from '../components/Card';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { bandLabels } from '../engine/bands';
import { aggregate, quantileWeight, weightBinKey } from '../engine/model';
import { regionOf } from '../engine/regions';
import { writeXlsx } from '../engine/xlsxWriter';
import { BandEditor } from './BandEditor';
import { NOTE_MARK, ProvinceNoteList, useProvinceNote } from '../components/ProvinceNotes';

type MetricKey = 'unitProfit' | 'unitNet' | 'profit' | 'net' | 'margin' | 'n' | 'unitIncome' | 'unitCost';
const METRIC_OPTS: { value: MetricKey; label: string; money?: boolean; diverging?: boolean; tip: string }[] = [
  { value: 'unitProfit', label: '单票毛利', diverging: true, tip: 'unitProfit' },
  { value: 'unitNet', label: '单票纯利', diverging: true, tip: 'unitNet' },
  { value: 'profit', label: '总毛利', diverging: true, money: true, tip: 'profit' },
  { value: 'net', label: '总纯利', diverging: true, money: true, tip: 'net' },
  { value: 'margin', label: '毛利率', diverging: true, tip: 'margin' },
  { value: 'n', label: '票数', tip: 'tickets' },
  { value: 'unitIncome', label: '单票收入', tip: 'unitIncome' },
  { value: 'unitCost', label: '单票成本', tip: 'unitCost' },
];

const fmtMetric = (k: MetricKey, v: number) =>
  !Number.isFinite(v) ? '—' : k === 'n' ? fmtInt(v) : k === 'margin' ? fmtPct(v) : k === 'profit' || k === 'net' ? fmtMoney(v, 0) : v.toFixed(2);

export function MatrixPage() {
  const d = useDerived()!;
  const { s } = useStore();
  const op = s.opCost;
  const opSet = op.perTicket > 0 || op.fixedTotal > 0;
  const [metric, setMetric] = useState<MetricKey>(opSet ? 'unitNet' : 'unitProfit');
  const [sortBy, setSortBy] = useState<'n' | 'region'>('n');
  const [rankBy, setRankBy] = useState<'total' | 'unit'>('total');
  const minN = 5;
  const noteOf = useProvinceNote();
  const noteHtml = (p: string) => (noteOf(p) ? `<br/><span style="color:#b45309">${NOTE_MARK} ${noteOf(p)}</span>` : '');

  const bands = useMemo(() => bandRows(d, op), [d, op]);
  const provs = useMemo(() => provRows(d, op), [d, op]);
  const matrix = useMemo(() => matrixRows(d, op), [d, op]);
  const labels = bandLabels(d.bands);

  const provOrder = useMemo(() => {
    const idx = provs.filter((p) => p.n > 0).map((p) => p.key);
    if (sortBy === 'n') idx.sort((a, b) => provs[b].n - provs[a].n);
    return idx; // 默认顺序即按大区 + 地理
  }, [provs, sortBy]);

  const heatmap = useCallback((t: Theme) => {
    const def = METRIC_OPTS.find((m) => m.value === metric)!;
    const data: [number, number, number | '-'][] = [];
    let maxAbs = 0, maxV = 0, minV = Infinity;
    provOrder.forEach((p, yi) => {
      matrix[p].forEach((c, b) => {
        if (c.n < (metric === 'n' ? 1 : minN)) { data.push([b, yi, '-']); return; }
        const v = c[metric];
        if (!Number.isFinite(v)) { data.push([b, yi, '-']); return; }
        data.push([b, yi, v]);
        maxAbs = Math.max(maxAbs, Math.abs(v)); maxV = Math.max(maxV, v); minV = Math.min(minV, v);
      });
    });
    // 颜色刻度取 90 分位，避免个别极端格子（如新藏重货）把其余格子都压成浅色；超出的格子按最深色显示
    const vals = data.map((x) => x[2]).filter((v): v is number => v !== '-');
    const q90 = (arr: number[]) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : 0; };
    const absCap = Math.min(maxAbs, q90(vals.map(Math.abs))) || maxAbs;
    const hiCap = Math.min(maxV, q90(vals)) || maxV;
    const o = baseOption(t);
    const visualMap = def.diverging
      ? { min: -absCap || -1, max: absCap || 1, inRange: { color: divergingColors(t) } }
      : { min: Math.min(0, minV === Infinity ? 0 : minV), max: hiCap || 1, inRange: { color: t.seq } };
    return {
      ...o,
      legend: { show: false },
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      tooltip: {
        ...(o.tooltip as object),
        formatter: (p: { value: [number, number, number | '-'] }) => {
          const [b, yi] = p.value;
          const c = matrix[provOrder[yi]][b];
          if (!c.n) return `${d.model.provNames[provOrder[yi]]} · ${labels[b]}kg<br/>无数据`;
          return `<b>${d.model.provNames[provOrder[yi]]} · ${labels[b]}kg</b><br/>票数 ${fmtInt(c.n)}（占 ${fmtPct(c.share, 2)}）<br/>单票收入 ${fmtUnit(c.unitIncome)}　单票成本 ${fmtUnit(c.unitCost)}<br/>单票毛利 <b>${fmtUnit(c.unitProfit)}</b>　毛利率 ${fmtPct(c.margin)}${opSet ? `<br/>单票纯利 <b>${fmtUnit(c.unitNet)}</b>` : ''}<br/>亏损票 ${fmtPct(c.lossN / c.n)}${c.n < minN ? '<br/><i>样本少于 5 单，仅供参考</i>' : ''}${noteHtml(d.model.provNames[provOrder[yi]])}`;
        },
      },
      xAxis: { type: 'category', data: labels.map((l) => l + 'kg'), position: 'top', ...axisStyle(t), splitArea: { show: false }, axisLabel: { color: t.ink2, fontSize: 11 } },
      yAxis: { type: 'category', data: provOrder.map((p) => d.model.provNames[p] + (noteOf(d.model.provNames[p]) ? ' ' + NOTE_MARK : '')), inverse: true, ...axisStyle(t), axisLabel: { color: t.ink2, fontSize: 11 } },
      visualMap: { ...visualMap, text: [fmtMetric(metric, visualMap.max), fmtMetric(metric, visualMap.min)], calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 220, itemWidth: 12, textStyle: { color: t.muted, fontSize: 11 }, formatter: (v: number) => fmtMetric(metric, v) },
      series: [{
        type: 'heatmap',
        // 深色格子用白字，浅色格子用黑字
        data: data.map((x) => {
          if (x[2] === '-') return x;
          const strength = def.diverging ? Math.abs(x[2]) / (absCap || 1) : (x[2] - visualMap.min) / ((visualMap.max - visualMap.min) || 1);
          return { value: x, label: { color: strength > 0.6 ? '#ffffff' : t.ink } };
        }),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
        label: { show: true, fontSize: 10, color: t.ink, formatter: (p: { value: [number, number, number | '-'] }) => (p.value[2] === '-' ? '' : fmtMetric(metric, p.value[2] as number)) },
      }],
    };
  }, [matrix, provOrder, metric, labels, opSet, d.model.provNames, noteOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const bandChart = useCallback((t: Theme) => {
    const o = baseOption(t);
    // 票数过少的重量段（如个别重货）会把纵轴拉得很高，图里不画，表格里照常列出
    const rows = bands.filter((b) => b.n >= Math.max(10, d.count * 0.001));
    const series: object[] = [
      { type: 'bar', name: '单票收入', data: rows.map((r) => +r.unitIncome.toFixed(3)), itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] }, barGap: '8%', barMaxWidth: 26 },
      { type: 'bar', name: '单票成本', data: rows.map((r) => +r.unitCost.toFixed(3)), itemStyle: { color: t.series[1], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 },
      { type: 'line', name: '单票毛利', data: rows.map((r) => +r.unitProfit.toFixed(3)), symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { color: t.series[2] },
        label: { show: true, position: 'top', color: t.ink, fontSize: 11, formatter: (p: { value: number }) => p.value.toFixed(2) } },
    ];
    if (opSet) series.push({ type: 'line', name: '单票纯利', data: rows.map((r) => +r.unitNet.toFixed(3)), symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { color: t.series[6] } });
    return {
      ...o,
      tooltip: { ...(o.tooltip as object), trigger: 'axis', formatter: (ps: { dataIndex: number; seriesName: string; value: number; marker: string }[]) => {
        const r = rows[ps[0].dataIndex];
        return `<b>${r.label}kg</b>　${fmtInt(r.n)} 单（${fmtPct(r.share)}）<br/>` + ps.map((p) => `${p.marker}${p.seriesName} ${p.value.toFixed(3)}`).join('<br/>') + `<br/>毛利率 ${fmtPct(r.margin)}　亏损票 ${fmtPct(r.lossN / r.n)}`;
      } },
      xAxis: { type: 'category', data: rows.map((r) => r.label + 'kg'), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', name: '元/票', ...axisStyle(t) },
      series,
    };
  }, [bands, opSet, d.count]);

  const ranking = useCallback((t: Theme) => {
    const key = rankBy === 'total' ? (opSet ? 'net' : 'profit') : opSet ? 'unitNet' : 'unitProfit';
    const rows = provs.filter((p) => p.n >= minN).sort((a, b) => (b[key] as number) - (a[key] as number));
    const o = baseOption(t);
    return {
      ...o,
      legend: { show: false },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0].dataIndex];
        return `<b>${r.label}</b>（${regionOf(r.label)}）<br/>${fmtInt(r.n)} 单，占 ${fmtPct(r.share)}<br/>总毛利 ${fmtMoney(r.profit)}　单票毛利 ${fmtUnit(r.unitProfit)}${opSet ? `<br/>总纯利 ${fmtMoney(r.net)}　单票纯利 ${fmtUnit(r.unitNet)}` : ''}${noteHtml(r.label)}`;
      } },
      xAxis: { type: 'value', ...axisStyle(t), name: rankBy === 'total' ? '元' : '元/票' },
      yAxis: { type: 'category', data: rows.map((r) => r.label + (noteOf(r.label) ? ' ' + NOTE_MARK : '')), inverse: true, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11, interval: 0 } },
      series: [{
        type: 'bar', data: rows.map((r) => +(r[key] as number).toFixed(3)), barMaxWidth: 14,
        itemStyle: { color: (p: { value: number }) => (p.value < 0 ? t.div.neg[1] : t.series[0]), borderRadius: 3 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 10, formatter: (p: { value: number }) => (rankBy === 'total' ? fmtMoney(p.value, 0) : p.value.toFixed(2)) },
      }],
    };
  }, [provs, rankBy, opSet]);

  const curve = useMemo(() => {
    if (!d.model.cols.weight) return null;
    const [p99] = quantileWeight(d.model, d.mask, [0.99]);
    const maxW = Math.min(10, Math.max(2, Math.ceil(p99 * 2) / 2));
    const step = 0.1;
    const { key, K } = weightBinKey(d.model, step, maxW);
    const a = aggregate(d.model, d.mask, key, K);
    const xs: string[] = [], inc: (number | null)[] = [], cost: (number | null)[] = [], prof: (number | null)[] = [], net: (number | null)[] = [], n: number[] = [];
    for (let i = 0; i < K; i++) {
      const c = a.n[i];
      xs.push(i === K - 1 ? `>${maxW.toFixed(1)}` : ((i + 1) * step).toFixed(1));
      n.push(c);
      const ok = c >= 5;
      const opc = op.perTicket + (d.count ? op.fixedTotal / d.count : 0);
      inc.push(ok && a.sum.income ? +(a.sum.income[i] / c).toFixed(3) : null);
      cost.push(ok && a.sum.cost ? +(a.sum.cost[i] / c).toFixed(3) : null);
      prof.push(ok && a.sum.profit ? +(a.sum.profit[i] / c).toFixed(3) : null);
      net.push(ok && a.sum.profit ? +(a.sum.profit[i] / c - opc).toFixed(3) : null);
    }
    return { xs, inc, cost, prof, net, n, maxW };
  }, [d, op]);

  const curveChart = useCallback((t: Theme) => {
    const c = curve!;
    const o = baseOption(t);
    const series: object[] = [
      { type: 'line', name: '单票收入', data: c.inc, showSymbol: false, step: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[0] }, connectNulls: false },
      { type: 'line', name: '单票成本', data: c.cost, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[1] } },
      { type: 'line', name: '单票毛利', data: c.prof, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[2] },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] } },
    ];
    if (opSet) series.push({ type: 'line', name: '单票纯利', data: c.net, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[6] } });
    return {
      ...o,
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', formatter: (ps: { dataIndex: number; seriesName: string; value: number | null; marker: string }[]) => {
        const i = ps[0].dataIndex;
        const lo = (i * 0.1).toFixed(1);
        return `<b>${i === c.xs.length - 1 ? c.xs[i] : lo + '–' + c.xs[i]} kg</b>　${fmtInt(c.n[i])} 单<br/>` + ps.filter((p) => p.value !== null).map((p) => `${p.marker}${p.seriesName} ${(p.value as number).toFixed(3)}`).join('<br/>');
      } },
      xAxis: { type: 'category', data: c.xs, name: 'kg', ...axisStyle(t), splitLine: { show: false }, boundaryGap: false },
      yAxis: { type: 'value', name: '元/票', ...axisStyle(t) },
      series,
    };
  }, [curve, opSet]);

  const curveVolume = useCallback((t: Theme) => {
    const c = curve!;
    const o = baseOption(t);
    const total = c.n.reduce((a, b) => a + b, 0) || 1;
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${fmtInt(v)} 单（${fmtPct(v / total)}）` },
      xAxis: { type: 'category', data: c.xs, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', name: '票数', ...axisStyle(t) },
      series: [{ type: 'bar', name: '票数', data: c.n, itemStyle: { color: t.seq[3], borderRadius: [2, 2, 0, 0] }, barCategoryGap: '20%' }],
    };
  }, [curve]);

  const quadrant = useCallback((t: Theme) => {
    const key = opSet ? 'unitNet' : 'unitProfit';
    // 占比极小的流向（如新藏）单票利润波动大，会把纵轴拉开，象限图里不画
    const rows = provs.filter((p) => p.n >= minN && p.share >= 0.003);
    const avgShare = 1 / Math.max(1, rows.length);
    const avgY = rows.reduce((a, r) => a + (r[key] as number) * r.n, 0) / Math.max(1, rows.reduce((a, r) => a + r.n, 0));
    const maxN = Math.max(...rows.map((r) => r.n), 1);
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        return `<b>${r.label}</b><br/>票量占比 ${fmtPct(r.share, 2)}<br/>${opSet ? '单票纯利' : '单票毛利'} ${fmtUnit(r[key] as number)}<br/>${opSet ? '总纯利' : '总毛利'} ${fmtMoney(opSet ? r.net : r.profit)}${noteHtml(r.label)}`;
      } },
      xAxis: { type: 'log', name: '票量占比', ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmtPct(v, v < 0.01 ? 1 : 0) } },
      yAxis: { type: 'value', name: opSet ? '单票纯利' : '单票毛利', ...axisStyle(t) },
      series: [{
        type: 'scatter',
        data: rows.map((r) => [Math.max(r.share, 1e-4), +(r[key] as number).toFixed(3)]),
        symbolSize: (_: unknown, p: { dataIndex: number }) => 8 + 22 * Math.sqrt(rows[p.dataIndex].n / maxN),
        itemStyle: { color: (p: { dataIndex: number }) => ((rows[p.dataIndex][key] as number) < 0 ? t.div.neg[1] : t.series[0]), opacity: 0.85, borderColor: t.surface, borderWidth: 2 },
        label: { show: true, position: 'right', fontSize: 10, color: t.ink2, formatter: (p: { dataIndex: number }) => rows[p.dataIndex].label },
        labelLayout: { hideOverlap: true },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { color: t.muted, fontSize: 10 },
          data: [{ xAxis: avgShare, label: { formatter: '平均占比' } }, { yAxis: avgY, label: { formatter: '整体均值' } }] },
      }],
    };
  }, [provs, opSet]);

  const exportTable = () => {
    const head = ['省份', '大区', '重量段(kg)', '票数', '票量占比', '单票收入', '单票成本', '单票毛利', '毛利率', '总收入', '总成本', '总毛利', '亏损票数', '线下成本', '总纯利', '单票纯利'];
    const rows: (string | number)[][] = [head];
    const push = (prov: string, band: string, r: GroupRow) => rows.push([prov, regionOf(prov), band, r.n, +r.share.toFixed(5), +r.unitIncome.toFixed(4), +r.unitCost.toFixed(4), +r.unitProfit.toFixed(4), +r.margin.toFixed(4), +r.income.toFixed(2), +r.cost.toFixed(2), +r.profit.toFixed(2), r.lossN, +r.opc.toFixed(2), +r.net.toFixed(2), +r.unitNet.toFixed(4)]);
    provOrder.forEach((p) => matrix[p].forEach((c, b) => c.n && push(d.model.provNames[p], labels[b], c)));
    const sumRows: (string | number)[][] = [head];
    bands.forEach((b) => b.n && sumRows.push(['全部', '', b.label, b.n, +b.share.toFixed(5), +b.unitIncome.toFixed(4), +b.unitCost.toFixed(4), +b.unitProfit.toFixed(4), +b.margin.toFixed(4), +b.income.toFixed(2), +b.cost.toFixed(2), +b.profit.toFixed(2), b.lossN, +b.opc.toFixed(2), +b.net.toFixed(2), +b.unitNet.toFixed(4)]));
    downloadXlsx(writeXlsx([
      { name: '省份×重量段', rows, colWidths: [8, 6, 10, 9, 9, 9, 9, 9, 8, 11, 11, 11, 9, 10, 11, 9] },
      { name: '重量段汇总', rows: sumRows, colWidths: [8, 6, 10, 9, 9, 9, 9, 9, 8, 11, 11, 11, 9, 10, 11, 9] },
    ]), '流向重量利润明细');
  };

  const def = METRIC_OPTS.find((m) => m.value === metric)!;
  return (
    <div className="grid">
      <BandEditor />
      <ProvinceNoteList />
      <Card
        title={`流向 × 重量段：${def.label}`}
        metric={def.tip}
        subtitle={`红色 = 亏损，蓝色 = 盈利，颜色越深金额越大；少于 ${minN} 单的格子不着色。悬停格子看完整收支。`}
        span={2}
        exportName={`流向重量${def.label}热力图`}
        actions={
          <>
            <select className="sel" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} aria-label="指标">
              {METRIC_OPTS.filter((m) => opSet || (m.value !== 'unitNet' && m.value !== 'net')).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <Seg size="sm" value={sortBy} onChange={setSortBy} options={[{ value: 'n', label: '按票量' }, { value: 'region', label: '按大区' }]} />
            <button type="button" className="icon-btn" onClick={exportTable}>⤓ 明细表</button>
          </>
        }
      >
        <Chart option={heatmap} height={Math.max(260, provOrder.length * 24 + 90)} />
      </Card>

      <Card title="各重量段单票收支" metric="unitProfit" subtitle="柱 = 单票收入与成本，线 = 单票利润；看哪个重量段收不抵支（票数不足 0.1% 的重量段只在下表列出）" exportName="重量段单票收支">
        <Chart option={bandChart} height={320} />
        <table className="tbl compact">
          <thead><tr><th>重量段</th><th className="r">票数</th><th className="r">占比</th><th className="r">单票毛利</th><th className="r">总毛利</th>{opSet && <th className="r">总纯利</th>}</tr></thead>
          <tbody>
            {bands.filter((b) => b.n).map((b) => (
              <tr key={b.key}>
                <td>{b.label}kg</td><td className="r num">{fmtInt(b.n)}</td><td className="r num">{fmtPct(b.share)}</td>
                <td className={`r num ${b.unitProfit < 0 ? 'neg' : ''}`}>{fmtUnit(b.unitProfit)}</td>
                <td className={`r num ${b.profit < 0 ? 'neg' : ''}`}>{fmtMoney(b.profit)}</td>
                {opSet && <td className={`r num ${b.net < 0 ? 'neg' : ''}`}>{fmtMoney(b.net)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title={`省份${rankBy === 'total' ? (opSet ? '总纯利' : '总毛利') : opSet ? '单票纯利' : '单票毛利'}排行`}
        metric={opSet ? 'net' : 'profit'}
        exportName="省份利润排行"
        actions={<Seg size="sm" value={rankBy} onChange={setRankBy} options={[{ value: 'total', label: '总额' }, { value: 'unit', label: '单票' }]} />}
      >
        <Chart option={ranking} height={Math.max(300, provs.filter((p) => p.n >= minN).length * 18 + 30)} />
      </Card>

      {curve && (
        <Card title="按 0.1kg 细分的单票利润曲线" metric="unitProfit" subtitle={`精确找到利润由正转负的重量点（少于 5 单的重量档不画线；横轴截到 ${curve.maxW}kg）`} span={2} exportName="0.1kg单票利润曲线">
          <Chart option={curveChart} height={300} />
          <Chart option={curveVolume} height={140} />
        </Card>
      )}

      <Card title="流向象限：票量 × 单票利润" metric={opSet ? 'unitNet' : 'unitProfit'} subtitle="右上 = 量大且赚钱（守住）；右下 = 量大但亏钱（优先调价）；气泡大小 = 票量；占比 < 0.3% 的流向不显示" span={2} exportName="流向象限图">
        <Chart option={quadrant} height={380} />
      </Card>
    </div>
  );
}
