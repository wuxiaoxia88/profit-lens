// 卡片：报告的基本单元。右上角可导出高清 PNG；导出 PDF 时按卡片分页排版。
import { useRef, useState, type ReactNode } from 'react';
import { exportNodePng } from '../app/exporter';
import { Tip } from './Tip';

export function Card({
  title, subtitle, metric, tip, actions, children, className = '', exportName, span = 1,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  metric?: string;
  tip?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  exportName?: string;
  span?: 1 | 2;
}) {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const doExport = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      await exportNodePng(ref.current, exportName ?? (typeof title === 'string' ? title : '图表'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section ref={ref} className={`card report-card ${span === 2 ? 'span-2' : ''} ${className}`}>
      <header className="card-head">
        <div>
          <h3 className="card-title">
            {title}
            {(metric || tip) && <Tip metric={metric}>{tip}</Tip>}
          </h3>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        <div className="card-actions no-export">
          {actions}
          <button type="button" className="icon-btn" onClick={doExport} disabled={busy} title="导出高清 PNG">
            {busy ? '…' : '⤓ PNG'}
          </button>
        </div>
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Kpi({ label, metric, value, sub, tone }: { label: string; metric?: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'warn' }) {
  return (
    <div className={`kpi ${tone ? 'kpi-' + tone : ''}`}>
      <div className="kpi-label">
        {label}
        {metric && <Tip metric={metric} />}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={`seg ${size === 'sm' ? 'seg-sm' : ''}`} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-note">{children}</div>;
}
