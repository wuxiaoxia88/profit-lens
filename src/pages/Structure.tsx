// 结构占比：重量段与重量分布、流向（省份/大区）占比、省份×重量段结构、面单账号占比。
// 不依赖收入/成本字段，只要有目的地和重量就能用。
import { useCallback, useMemo, useState } from 'react';
import { bandRows, matrixRows, provRows, rowsOf } from '../app/analysis';
import { fmtInt, fmtKg, fmtPct, fmtUnit } from '../app/format';
import { useDerived, useStore } from '../app/store';
import type { Theme } from '../app/theme';
import { Card, Kpi, Seg } from '../components/Card';
import { axisStyle, baseOption, Chart } from '../components/Chart';
import { TileMap, type TileDatum } from '../components/TileMap';
import { bandLabels } from '../engine/bands';
import { aggregate, quantileWeight, weightBinKey } from '../engine/model';
import { REGIONS, regionOf } from '../engine/regions';
import { BandEditor } from './BandEditor';

export function StructurePage() {
  const d = useDerived()!;
  const { s } = useStore();
  const op = s.opCost;
  const opSet = op.perTicket > 0 || op.fixedTotal > 0;
  const hasProfit = d.model.caps.profit;
  const [tileMetric, setTileMetric] = useState<'share' | 'profit'>('share');
  const [mixMode, setMixMode] = useState<'all' | 'row'>('all');

  const bands = useMemo(() => bandRows(d, op), [d, op]);
  const provs = useMemo(() => provRows(d, op), [d, op]);
  const matrix = useMemo(() => matrixRows(d, op), [d, op]);
  const qs = useMemo(() => quantileWeight(d.model, d.mask, [0.5, 0.8, 0.9, 0.95, 0.99]), [d]);
  const total = d.count;
  const avgW = useMemo(() => {
    const w = d.model.cols.weight;
    if (!w) return NaN;
    let s2 = 0;
    for (let i = 0; i < d.model.n; i++) if (d.mask[i] && w[i] === w[i]) s2 += w[i];
    return s2 / Math.max(1, total);
  }, [d, total]);

  const bandChart = useCallback((t: Theme) => {
    const o = baseOption(t);
    let cum = 0;
    const cums = bands.map((b) => (cum += b.share));
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const b = bands[ps[0].dataIndex];
        return `<b>${b.label}kg</b><br/>${fmtInt(b.n)} 单，占 ${fmtPct(b.share, 2)}<br/>累计 ${fmtPct(cums[ps[0].dataIndex], 2)}<br/>均重 ${fmtKg(b.avgW)} kg`;
      } },
      xAxis: { type: 'category', data: bands.map((b) => b.label + 'kg'), ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11, interval: 0 } },
      yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmtPct(v, 0) } },
      series: [{
        type: 'bar', data: bands.map((b) => b.share), barMaxWidth: 44,
        itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: t.ink, fontSize: 11, formatter: (p: { value: number; dataIndex: number }) => `${fmtPct(p.value)}\n{c|累计 ${fmtPct(cums[p.dataIndex], 0)}}`, rich: { c: { color: t.muted, fontSize: 10 } } },
      }],
    };
  }, [bands]);

  const hist = useMemo(() => {
    if (!d.model.cols.weight) return null;
    const maxW = Math.min(10, Math.max(2, Math.ceil(qs[4] * 2) / 2));
    const { key, K } = weightBinKey(d.model, 0.1, maxW);
    const a = aggregate(d.model, d.mask, key, K);
    return { xs: Array.from({ length: K }, (_, i) => (i === K - 1 ? `>${maxW.toFixed(1)}` : ((i + 1) * 0.1).toFixed(1))), n: Array.from(a.n), maxW };
  }, [d, qs]);

  const histChart = useCallback((t: Theme) => {
    const h = hist!;
    const o = baseOption(t);
    const marks = [['P50', qs[0]], ['P80', qs[1]], ['P90', qs[2]], ['P95', qs[3]]] as const;
    const idxOf = (w: number) => Math.min(h.xs.length - 1, Math.max(0, Math.ceil(w / 0.1 - 1e-9) - 1));
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0].dataIndex;
        return `<b>${i === h.xs.length - 1 ? h.xs[i] : (i * 0.1).toFixed(1) + '–' + h.xs[i]} kg</b><br/>${fmtInt(h.n[i])} 单（${fmtPct(h.n[i] / Math.max(1, total), 2)}）`;
      } },
      xAxis: { type: 'category', data: h.xs, name: 'kg', ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', name: '票数', ...axisStyle(t) },
      series: [{
        type: 'bar', data: h.n, barCategoryGap: '15%', itemStyle: { color: t.seq[4], borderRadius: [2, 2, 0, 0] },
        markLine: {
          silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'solid', width: 1 },
          label: { show: false },
          data: marks.map(([name, w]) => ({ name: `${name} ${fmtKg(w)}`, xAxis: idxOf(w) })),
        },
      }],
    };
  }, [hist, qs, total]);

  const tiles = useMemo(() => {
    const out: Record<string, TileDatum> = {};
    for (const p of provs) {
      if (!p.n) continue;
      const unit = opSet ? p.unitNet : p.unitProfit;
      out[p.label] = {
        value: tileMetric === 'share' ? p.share : p.n >= 5 ? unit : null,
        label: tileMetric === 'share' ? fmtPct(p.share) : p.n >= 5 ? unit.toFixed(2) : '样本少',
        tip: `${p.label}（${regionOf(p.label)}）：${fmtInt(p.n)} 单，占 ${fmtPct(p.share, 2)}，均重 ${fmtKg(p.avgW)}kg` + (hasProfit ? `，单票毛利 ${fmtUnit(p.unitProfit)}${opSet ? `，单票纯利 ${fmtUnit(p.unitNet)}` : ''}` : ''),
      };
    }
    return out;
  }, [provs, tileMetric, opSet, hasProfit]);

  const provBar = useCallback((t: Theme) => {
    const rows = provs.filter((p) => p.n > 0).sort((a, b) => b.n - a.n);
    let cum = 0;
    const cums = rows.map((r) => (cum += r.share));
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0].dataIndex];
        return `<b>${r.label}</b>（${regionOf(r.label)}）<br/>${fmtInt(r.n)} 单，占 ${fmtPct(r.share, 2)}<br/>累计 ${fmtPct(cums[ps[0].dataIndex], 1)}<br/>均重 ${fmtKg(r.avgW)} kg`;
      } },
      xAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmtPct(v, 0) } },
      yAxis: { type: 'category', data: rows.map((r) => r.label), inverse: true, ...axisStyle(t), splitLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 11, interval: 0 } },
      series: [{ type: 'bar', data: rows.map((r) => r.share), barMaxWidth: 14, itemStyle: { color: t.series[0], borderRadius: 3 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 10, formatter: (p: { value: number }) => fmtPct(p.value) } }],
    };
  }, [provs]);

  const regions = useMemo(() => {
    const out = REGIONS.map((r) => ({ name: r, n: 0 }));
    for (const p of provs) out[REGIONS.indexOf(regionOf(p.label))].n += p.n;
    return out.filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  }, [provs]);

  const regionChart = useCallback((t: Theme) => {
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(o.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmtPct(v, 2) },
      xAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmtPct(v, 0) } },
      yAxis: { type: 'category', data: regions.map((r) => r.name), inverse: true, ...axisStyle(t), splitLine: { show: false } },
      series: [{ type: 'bar', data: regions.map((r) => r.n / Math.max(1, total)), barMaxWidth: 18, itemStyle: { color: t.series[0], borderRadius: 3 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { value: number; dataIndex: number }) => `${fmtPct(p.value)}（${fmtInt(regions[p.dataIndex].n)}）` } }],
    };
  }, [regions, total]);

  const mixChart = useCallback((t: Theme) => {
    const labels = bandLabels(d.bands);
    const order = provs.filter((p) => p.n > 0).sort((a, b) => b.n - a.n).map((p) => p.key);
    const data: [number, number, number][] = [];
    let max = 0;
    order.forEach((p, yi) => matrix[p].forEach((c, b) => {
      const v = mixMode === 'all' ? c.n / Math.max(1, total) : c.n / Math.max(1, provs[p].n);
      data.push([b, yi, v]);
      max = Math.max(max, v);
    }));
    const o = baseOption(t);
    return {
      ...o, legend: { show: false },
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      tooltip: { ...(o.tooltip as object), formatter: (p: { value: [number, number, number] }) => {
        const c = matrix[order[p.value[1]]][p.value[0]];
        return `<b>${d.model.provNames[order[p.value[1]]]} · ${labels[p.value[0]]}kg</b><br/>${fmtInt(c.n)} 单<br/>占全部 ${fmtPct(c.n / Math.max(1, total), 2)}<br/>占该省 ${fmtPct(c.n / Math.max(1, provs[order[p.value[1]]].n), 1)}`;
      } },
      xAxis: { type: 'category', data: labels.map((l) => l + 'kg'), position: 'top', ...axisStyle(t), axisLabel: { color: t.ink2, fontSize: 11 } },
      yAxis: { type: 'category', data: order.map((p) => d.model.provNames[p]), inverse: true, ...axisStyle(t), axisLabel: { color: t.ink2, fontSize: 11 } },
      visualMap: { min: 0, max: max || 1, text: [fmtPct(max || 1, 1), '0%'], calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 220, itemWidth: 12, inRange: { color: t.seq }, textStyle: { color: t.muted, fontSize: 11 }, formatter: (v: number) => fmtPct(v, 1) },
      series: [{ type: 'heatmap',
        data: data.map((x) => (x[2] > 0 ? { value: x, label: { color: x[2] / (max || 1) > 0.55 ? '#ffffff' : t.ink } } : { value: [x[0], x[1], '-'] })),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: true, fontSize: 10, color: t.ink, formatter: (p: { value: [number, number, number] }) => (p.value[2] >= 0.0005 ? fmtPct(p.value[2], p.value[2] < 0.01 ? 2 : 1) : '') } }],
    };
  }, [d, provs, matrix, mixMode, total]);

  const accounts = useMemo(() => {
    const col = d.model.data.dict.account;
    if (!col) return null;
    const a = aggregate(d.model, d.mask, col.codes, col.values.length);
    const nameCol = d.model.data.dict.accountName;
    const nameOfAcc = new Map<number, number>();
    if (nameCol) for (let i = 0; i < d.model.n; i++) if (!nameOfAcc.has(col.codes[i])) nameOfAcc.set(col.codes[i], nameCol.codes[i]);
    return rowsOf(a, col.values.map((_, c) => d.nameOf('account', c)), total, op)
      .filter((r) => r.n > 0)
      .sort((x, y) => y.n - x.n)
      .map((r) => ({ ...r, shop: nameCol && nameOfAcc.has(r.key) ? d.nameOf('accountName', nameOfAcc.get(r.key)!) : '' }));
  }, [d, total, op]);

  return (
    <div className="grid">
      <BandEditor />
      <Card title="重量结构" subtitle="把握客户货物的轻重：报价时重量段越贴近实际分布越准" span={2} className="kpi-card">
        <div className="kpis">
          <Kpi label="平均结算重量" metric="avgWeight" value={fmtKg(avgW) + ' kg'} />
          <Kpi label="中位数 P50" value={fmtKg(qs[0]) + ' kg'} sub="一半的单不超过此重量" />
          <Kpi label="P80" value={fmtKg(qs[1]) + ' kg'} sub="80% 的单不超过" />
          <Kpi label="P90" value={fmtKg(qs[2]) + ' kg'} sub="90% 的单不超过" />
          <Kpi label="P95" value={fmtKg(qs[3]) + ' kg'} sub="95% 的单不超过" />
        </div>
      </Card>
      <Card title="重量段票量占比" metric="tickets" exportName="重量段占比">
        <Chart option={bandChart} height={300} />
      </Card>
      {hist && (
        <Card title="重量分布（每 0.1kg）" metric="avgWeight" subtitle={`竖线依次为 P50 ${fmtKg(qs[0])} · P80 ${fmtKg(qs[1])} · P90 ${fmtKg(qs[2])} · P95 ${fmtKg(qs[3])} kg；横轴截到 ${hist.maxW}kg，更重的并入最后一档`} exportName="重量分布">
          <Chart option={histChart} height={300} />
        </Card>
      )}
      <Card
        title={tileMetric === 'share' ? '流向分布地图（票量占比）' : `流向${opSet ? '单票纯利' : '单票毛利'}地图`}
        metric={tileMetric === 'share' ? 'tickets' : opSet ? 'unitNet' : 'unitProfit'}
        subtitle="每个省一个方块，按地理位置大致排布；颜色越深占比越高"
        exportName="流向分布地图"
        actions={hasProfit ? <Seg size="sm" value={tileMetric} onChange={setTileMetric} options={[{ value: 'share', label: '票量占比' }, { value: 'profit', label: opSet ? '单票纯利' : '单票毛利' }]} /> : undefined}
      >
        <TileMap data={tiles} mode={tileMetric === 'share' ? 'seq' : 'div'} format={(v) => (tileMetric === 'share' ? fmtPct(v, 0) : v.toFixed(2))} />
      </Card>
      <Card title="省份票量占比排行" metric="tickets" exportName="省份占比排行">
        <Chart option={provBar} height={Math.max(300, provs.filter((p) => p.n > 0).length * 18 + 30)} />
      </Card>
      <Card title="大区占比" metric="tickets" exportName="大区占比">
        <Chart option={regionChart} height={240} />
      </Card>
      {accounts && (
        <Card title="面单账号占比" metric="tickets" subtitle="同一客户的不同店铺/平台账号" exportName="面单账号占比">
          <table className="tbl compact">
            <thead><tr><th>面单账号</th><th>店铺名称</th><th className="r">票数</th><th className="r">占比</th><th className="r">均重</th>{hasProfit && <th className="r">单票毛利</th>}</tr></thead>
            <tbody>
              {accounts.slice(0, 30).map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td><td className="muted">{r.shop}</td>
                  <td className="r num">{fmtInt(r.n)}</td>
                  <td className="r num"><span className="bar-cell" style={{ ['--w' as string]: `${r.share * 100}%` }}>{fmtPct(r.share)}</span></td>
                  <td className="r num">{fmtKg(r.avgW)}</td>
                  {hasProfit && <td className={`r num ${r.unitProfit < 0 ? 'neg' : ''}`}>{fmtUnit(r.unitProfit)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card
        title={mixMode === 'all' ? '省份 × 重量段 票量占全部比例' : '各省重量段构成（每行合计 100%）'}
        metric="tickets"
        span={2}
        exportName="省份重量段结构"
        actions={<Seg size="sm" value={mixMode} onChange={setMixMode} options={[{ value: 'all', label: '占全部' }, { value: 'row', label: '省内构成' }]} />}
      >
        <Chart option={mixChart} height={Math.max(260, provs.filter((p) => p.n > 0).length * 24 + 90)} />
      </Card>
    </div>
  );
}
