// 省份瓦片地图：每个省一个等大方块，按地理大致位置排布。比真实地图更公平（小省份也看得清），且无需地图数据。
import { useState } from 'react';
import { PROVINCES } from '../engine/regions';
import { useTheme } from '../app/useTheme';
import type { Theme } from '../app/theme';

export interface TileDatum {
  value: number | null;
  label: string; // 方块内第二行文字
  tip: string; // 悬停说明
  /** 有特殊区域备注 */
  flag?: boolean;
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function rampColor(ramp: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return lerpColor(ramp[i], ramp[i + 1], x - i);
}

function inkFor(bg: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? '#0b0b0b' : '#ffffff';
}

export function TileMap({ data, mode, format }: { data: Record<string, TileDatum>; mode: 'seq' | 'div'; format: (v: number) => string }) {
  const t: Theme = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const vals = Object.values(data).map((d) => d.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 0);
  const colorOf = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return t.dark ? '#262624' : '#f0efec';
    if (mode === 'seq') return rampColor(t.seq.slice(1), maxV > 0 ? v / maxV : 0);
    const ramp = [...t.div.neg, t.div.mid, ...t.div.pos];
    return rampColor(ramp, 0.5 + v / max / 2);
  };
  const S = 64, G = 4;
  const cols = 9, rows = 8;
  const hovered = hover ? data[hover] : null;
  return (
    <div className="tilemap">
      <svg viewBox={`0 0 ${cols * S} ${rows * S}`} role="img" aria-label="省份瓦片地图">
        {PROVINCES.map((p) => {
          const d = data[p.name];
          const bg = colorOf(d?.value ?? null);
          const ink = d && d.value !== null ? inkFor(bg) : t.muted;
          return (
            <g key={p.name} transform={`translate(${p.x * S + G / 2},${p.y * S + G / 2})`} onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}>
              <rect width={S - G} height={S - G} rx={6} fill={bg} stroke={hover === p.name ? t.ink : 'none'} strokeWidth={1.5} />
              <text x={(S - G) / 2} y={24} textAnchor="middle" fontSize={13} fontWeight={600} fill={ink}>{p.name}</text>
              {d?.flag && <text x={S - G - 5} y={13} textAnchor="end" fontSize={10} fill={ink}>⚑</text>}
              <text x={(S - G) / 2} y={43} textAnchor="middle" fontSize={11} fill={ink}>{d?.label ?? ''}</text>
              <title>{d?.tip ?? `${p.name}：无数据`}</title>
            </g>
          );
        })}
      </svg>
      <div className="tile-legend">
        {mode === 'seq' ? (
          <>
            <span>{format(0)}</span>
            <i style={{ background: `linear-gradient(90deg, ${t.seq.slice(1).join(',')})` }} />
            <span>{format(maxV)}</span>
          </>
        ) : (
          <>
            <span>亏 {format(-max)}</span>
            <i style={{ background: `linear-gradient(90deg, ${[...t.div.neg, t.div.mid, ...t.div.pos].join(',')})` }} />
            <span>赚 {format(max)}</span>
          </>
        )}
        {minV < 0 && mode === 'seq' ? null : null}
      </div>
      <div className="tile-hover no-export" aria-live="polite">{hovered ? hovered.tip : '把鼠标移到省份上查看详情'}</div>
    </div>
  );
}
