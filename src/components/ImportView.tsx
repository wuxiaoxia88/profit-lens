// 导入：拖拽/选择文件 → 识别表头 →（必要时）手动映射字段 → 后台解析。
import { useRef, useState } from 'react';
import { load, probe } from '../app/loader';
import { useStore } from '../app/store';
import { generateDemo } from '../engine/demo';
import type { ProbeResult } from '../engine/load';
import { capabilitiesOf, FIELDS, type ColumnMapping, type FieldId } from '../engine/schema';

export function useImporter() {
  const { dispatch } = useStore();
  const [pending, setPending] = useState<{ files: File[]; probes: ProbeResult[] } | null>(null);

  const run = async (files: File[], probes: ProbeResult[]) => {
    const t0 = performance.now();
    dispatch({ type: 'loading', loading: { stage: '解析数据', files: files.map((f) => f.name), fileIndex: 0, fraction: 0, rows: 0, startedAt: Date.now() } });
    try {
      const data = await load(files.map((file, i) => ({ file, probe: probes[i] })), (p) =>
        dispatch({ type: 'loading', loading: { stage: '解析数据', files: files.map((f) => f.name), ...p, startedAt: Date.now() } }),
      );
      if (!data.n) throw new Error('文件里没有读到数据行。请确认导出的是「单号明细」，并且第一张工作表就是明细表。');
      dispatch({ type: 'loading', loading: { stage: '建立分析模型', files: files.map((f) => f.name), fileIndex: files.length - 1, fraction: 1, rows: data.n, startedAt: Date.now() } });
      await new Promise((r) => setTimeout(r, 30));
      dispatch({ type: 'data', data, loadMs: performance.now() - t0 });
    } catch (e) {
      dispatch({ type: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const start = async (files: File[]) => {
    if (!files.length) return;
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'loading', loading: { stage: '识别表头', files: files.map((f) => f.name), fileIndex: 0, fraction: 0, rows: 0, startedAt: Date.now() } });
    try {
      const probes = await probe(files);
      const needsMapping = probes.some((p) => p.mapping.dest === undefined || p.mapping.weight === undefined);
      if (needsMapping) {
        dispatch({ type: 'loading', loading: null });
        setPending({ files, probes });
        return;
      }
      await run(files, probes);
    } catch (e) {
      dispatch({ type: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const loadDemo = () => {
    const data = generateDemo(60000);
    dispatch({ type: 'data', data, loadMs: 0 });
  };

  const confirmMapping = (mapping: ColumnMapping) => {
    if (!pending) return;
    const probes = pending.probes.map((p) => ({ ...p, mapping: p.headers.join('\u0001') === pending.probes[0].headers.join('\u0001') ? mapping : p.mapping }));
    setPending(null);
    void run(pending.files, probes);
  };

  return { start, loadDemo, pending, confirmMapping, cancelMapping: () => setPending(null) };
}

export function FilePicker({ onFiles, children, className }: { onFiles: (f: File[]) => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>{children}</button>
      <input
        ref={ref}
        type="file"
        multiple
        accept=".xlsx,.csv,.txt"
        hidden
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
    </>
  );
}

export function Welcome({ importer }: { importer: ReturnType<typeof useImporter> }) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="welcome">
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void importer.start(Array.from(e.dataTransfer.files)); }}
      >
        <div className="dz-icon" aria-hidden>⇪</div>
        <h2>把「网点发件盈亏分析 - 单号明细」导出文件拖到这里</h2>
        <p>支持 .xlsx / .csv，可一次选择多个文件合并分析（例如按月分开导出的数据）。百万行数据约 10 秒内完成。</p>
        <div className="dz-actions">
          <FilePicker className="btn btn-primary" onFiles={(f) => void importer.start(f)}>选择文件</FilePicker>
          <button type="button" className="btn" onClick={importer.loadDemo}>先用示例数据看看</button>
        </div>
        <p className="dz-privacy">🔒 数据只在你这台电脑的浏览器里计算，不会上传到任何服务器。</p>
      </div>
      <div className="welcome-steps">
        <div><b>① 导出</b><span>在盈亏分析系统选择客户 → 单号明细 → 导出 Excel</span></div>
        <div><b>② 导入</b><span>拖入文件，自动识别字段，缺收入/成本列也能做流向、重量段分析</span></div>
        <div><b>③ 设置</b><span>在顶部填写网点线下操作管理成本，得到纯利</span></div>
        <div><b>④ 分析</b><span>看总览、流向×重量利润、结构占比，核对报价、模拟调价，导出 PNG/PDF</span></div>
      </div>
    </div>
  );
}

const GROUP_LABEL = { base: '基础字段', income: '收入字段', cost: '成本字段' } as const;

export function MappingDialog({ probe: p, onConfirm, onCancel }: { probe: ProbeResult; onConfirm: (m: ColumnMapping) => void; onCancel: () => void }) {
  const [mapping, setMapping] = useState<ColumnMapping>(p.mapping);
  const caps = capabilitiesOf(new Set(Object.keys(mapping).filter((k) => mapping[k as FieldId] !== undefined) as FieldId[]));
  const set = (f: FieldId, v: string) => setMapping((m) => {
    const next = { ...m };
    if (v === '') delete next[f];
    else next[f] = Number(v);
    return next;
  });
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="字段对应">
      <div className="modal">
        <h2>确认字段对应</h2>
        <p className="muted">没能自动识别「目的地」或「结算重量」。请为下列字段选择文件中对应的列（文件：{p.fileName}，表头在第 {p.headerRow + 1} 行）。</p>
        <div className="map-grid">
          {(['base', 'income', 'cost'] as const).map((g) => (
            <fieldset key={g}>
              <legend>{GROUP_LABEL[g]}</legend>
              {FIELDS.filter((f) => f.group === g).map((f) => (
                <label key={f.id} className="map-row">
                  <span>{f.label}{(f.id === 'dest' || f.id === 'weight') && <em> 必填</em>}</span>
                  <select value={mapping[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)}>
                    <option value="">（不导入）</option>
                    {p.headers.map((h, i) => (
                      <option key={i} value={i}>{h || `第 ${i + 1} 列`}{p.sample[0]?.[i] ? `（例：${String(p.sample[0][i]).slice(0, 12)}）` : ''}</option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <p className="muted small">
          可用功能：流向/重量段分析 {caps.structure ? '✓' : '✗'} · 收入 {caps.income ? '✓' : '✗'} · 成本 {caps.cost ? '✓' : '✗'} · 利润 {caps.profit ? '✓' : '✗'} · 报价核对 {caps.quote ? '✓' : '✗'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!caps.structure} onClick={() => onConfirm(mapping)}>开始导入</button>
        </div>
      </div>
    </div>
  );
}

export function LoadingOverlay() {
  const { s } = useStore();
  const l = s.loading;
  if (!l) return null;
  const pct = Math.round(((l.fileIndex + l.fraction) / Math.max(1, l.files.length)) * 100);
  return (
    <div className="modal-back">
      <div className="modal loading-modal" role="status" aria-live="polite">
        <h2>{l.stage}…</h2>
        <div className="progress"><div style={{ width: `${l.stage === '识别表头' ? 5 : pct}%` }} /></div>
        <p className="muted">
          {l.files.length > 1 ? `第 ${l.fileIndex + 1}/${l.files.length} 个文件：` : ''}
          {l.files[l.fileIndex]} · 已读取 {l.rows.toLocaleString('zh-CN')} 行
        </p>
      </div>
    </div>
  );
}
