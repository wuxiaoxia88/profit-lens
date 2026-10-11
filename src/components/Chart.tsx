// ECharts 封装：按需引入 + SVG 渲染（导出 PNG/PDF 时矢量清晰）。
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, MarkAreaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../app/useTheme';
import { FONT, type Theme } from '../app/theme';

echarts.use([BarChart, LineChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, SVGRenderer]);

export type Option = EChartsCoreOption;

/** 公共外观：细网格、弱化坐标轴、主题化提示框 */
export function baseOption(t: Theme): Option {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: FONT, color: t.ink2 },
    color: t.series,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink, fontSize: 12, fontFamily: FONT },
      extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:8px;',
    },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2 } },
  };
}

export function axisStyle(t: Theme) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, type: 'solid' as const } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
}

export function Chart({ option, height = 320, onClick }: { option: (t: Theme) => Option; height?: number; onClick?: (p: { dataIndex: number; seriesIndex?: number; data?: unknown }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const t = useTheme();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const el = ref.current!;
    const c = echarts.init(el, undefined, { renderer: 'svg' });
    inst.current = c;
    c.on('click', (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => { ro.disconnect(); c.dispose(); inst.current = null; };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option(t), { notMerge: true });
  }, [option, t]);

  return <div ref={ref} className="chart" style={{ height }} />;
}
