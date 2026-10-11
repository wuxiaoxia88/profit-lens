import { useState } from 'react';
import { exportPdf } from './app/exporter';
import { fmtInt } from './app/format';
import { useDerived, useStore, type TabId } from './app/store';
import { FilePicker, LoadingOverlay, MappingDialog, useImporter, Welcome } from './components/ImportView';
import { FilterBar, Header, OpCostBar, TABS } from './components/Shell';
import { dayToString } from './engine/dataset';
import { HelpPage } from './pages/HelpPage';
import { MatrixPage } from './pages/Matrix';
import { Overview } from './pages/Overview';
import { QualityPage } from './pages/QualityPage';
import { QuotePage } from './pages/QuotePage';
import { SimPage } from './pages/SimPage';
import { StructurePage } from './pages/Structure';

const REPORT_TABS: TabId[] = ['overview', 'matrix', 'structure', 'quote'];

export function App() {
  const { s, dispatch } = useStore();
  const d = useDerived();
  const importer = useImporter();
  const [exporting, setExporting] = useState<string | null>(null);
  const caps = d?.model.caps;
  const tabs = TABS.filter((t) => !t.needs || (t.needs === 'profit' ? caps?.profit : caps?.quote));
  const tab = d ? (tabs.some((t) => t.id === s.tab) ? s.tab : 'overview') : 'help';

  const doPdf = async (which: 'current' | 'full') => {
    if (!d) return;
    const list = which === 'current' ? [tab] : REPORT_TABS.filter((t) => tabs.some((x) => x.id === t));
    const original = tab;
    const f = s.filters;
    const cust = d.model.data.dict.customer;
    const custName = cust ? [...new Set(Array.from(cust.codes.slice(0, 5000)))].slice(0, 3).map((c) => d.nameOf('customer', c)).join('、') : '';
    const opSet = s.opCost.perTicket > 0 || s.opCost.fixedTotal > 0;
    const lines = [
      `数据范围：${dayToString(f.dateFrom ?? d.model.minDay)} ~ ${dayToString(f.dateTo ?? d.model.maxDay)}，${fmtInt(d.count)} 单（全部 ${fmtInt(d.model.n)} 单）`,
      `线下操作管理成本：${opSet ? `${s.opCost.perTicket} 元/票 + 固定 ${s.opCost.fixedTotal} 元` : '未设置（报告中的利润为系统毛利）'}`,
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
    ];
    setExporting('准备中…');
    try {
      await exportPdf(
        list.map((id) => ({
          title: TABS.find((t) => t.id === id)!.label,
          prepare: async () => {
            dispatch({ type: 'tab', tab: id });
            await new Promise((r) => setTimeout(r, 900));
            return Array.from(document.querySelectorAll<HTMLElement>('.page .report-card'));
          },
        })),
        { title: `${custName || '客户'}发件盈亏分析报告`, lines, footer: '盈亏透镜 · 毛利取自网点发件盈亏分析系统；纯利 = 毛利 − 使用者设置的线下操作管理成本，仅供内部经营决策参考。' },
        (i, n) => setExporting(`正在生成 PDF… ${i}/${n}`),
      );
    } catch (e) {
      dispatch({ type: 'error', error: 'PDF 导出失败：' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      dispatch({ type: 'tab', tab: original });
      setExporting(null);
    }
  };

  return (
    <div className="app">
      <Header
        right={
          d ? (
            <>
              <FilePicker className="btn btn-sm" onFiles={(f) => void importer.start(f)}>⇪ 导入新数据</FilePicker>
              <div className="dropdown">
                <button type="button" className="btn btn-sm btn-primary" disabled={!!exporting}>{exporting ?? '⤓ 导出 PDF'}</button>
                {!exporting && (
                  <div className="dropdown-menu">
                    <button type="button" onClick={() => void doPdf('current')}>当前页面</button>
                    <button type="button" onClick={() => void doPdf('full')}>完整报告（总览 + 利润矩阵 + 结构 + 报价）</button>
                  </div>
                )}
              </div>
            </>
          ) : null
        }
      />
      {s.error && (
        <div className="error-banner" role="alert">
          {s.error}
          <button type="button" className="link" onClick={() => dispatch({ type: 'error', error: null })}>关闭</button>
        </div>
      )}
      {d && <OpCostBar />}
      {d && <FilterBar />}
      {d && (
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => dispatch({ type: 'tab', tab: t.id })}>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      <main className="page">
        {!d && !s.loading && <Welcome importer={importer} />}
        {!d && <HelpLink />}
        {d && tab === 'overview' && <Overview />}
        {d && tab === 'matrix' && <MatrixPage />}
        {d && tab === 'structure' && <StructurePage />}
        {d && tab === 'quote' && <QuotePage />}
        {d && tab === 'sim' && <SimPage />}
        {d && tab === 'quality' && <QualityPage />}
        {d && tab === 'help' && <HelpPage />}
      </main>
      <LoadingOverlay />
      {importer.pending && <MappingDialog probe={importer.pending.probes.find((p) => p.mapping.dest === undefined || p.mapping.weight === undefined) ?? importer.pending.probes[0]} onConfirm={importer.confirmMapping} onCancel={importer.cancelMapping} />}
      {exporting && <div className="export-mask" aria-live="polite">{exporting}</div>}
    </div>
  );
}

function HelpLink() {
  const [open, setOpen] = useState(false);
  return (
    <div className="welcome-help">
      <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? '收起使用手册' : '📖 第一次使用？查看使用手册'}</button>
      {open && <HelpPage />}
    </div>
  );
}
