// 「ⓘ」角标：悬停/聚焦显示计算公式与数据来源。浮层挂到 body，避免被卡片裁切。
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { METRICS } from '../engine/metrics';

export function Tip({ metric, children, label = 'ⓘ' }: { metric?: string; children?: ReactNode; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const def = metric ? METRICS[metric] : undefined;
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    const up = r.bottom + 220 > window.innerHeight;
    setPos({ x: Math.min(window.innerWidth - 336, Math.max(8, r.left - 12)), y: up ? r.top - 8 : r.bottom + 8, up });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="tip-btn no-export"
        aria-label={def ? `${def.label}的口径说明` : '说明'}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
      >
        {label}
      </button>
      {pos &&
        createPortal(
          <div className="tip-pop" role="tooltip" style={{ left: pos.x, top: pos.y, transform: pos.up ? 'translateY(-100%)' : undefined }}>
            {def && (
              <>
                <div className="tip-title">{def.label}</div>
                <div className="tip-row"><span>计算</span>{def.formula}</div>
                <div className="tip-row"><span>来源</span>{def.source}</div>
                {def.note && <div className="tip-note">{def.note}</div>}
              </>
            )}
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
