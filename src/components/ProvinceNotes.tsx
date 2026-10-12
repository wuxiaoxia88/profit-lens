// 特殊区域提示：三个来源合并——数据分析（派费异常）、价格表里的地市特价、网点经验备注。
// 只以「⚑」标记 + 提示的方式出现，不改动省份价格与统计。
import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { DEFAULT_PROVINCE_NOTES, notesToText, parseNotesText } from '../engine/notes';
import { analyzeDispatch, CITY_TO_PROVINCE } from '../engine/specialAreas';
import { Tip } from './Tip';

export const NOTE_MARK = '⚑';

export interface AreaNote {
  source: '数据' | '价格表' | '网点';
  text: string;
}

/** 省份 → 各来源的提示 */
export function useAreaNotes(): Map<string, AreaNote[]> {
  const { s } = useStore();
  const model = s.model;
  const findings = useMemo(() => (model ? analyzeDispatch(model) : []), [model]);
  const book = s.quoteBook;
  const user = s.provinceNotes;
  return useMemo(() => {
    const out = new Map<string, AreaNote[]>();
    const add = (p: string, n: AreaNote) => {
      const list = out.get(p) ?? [];
      if (!list.some((x) => x.text === n.text)) list.push(n);
      out.set(p, list);
    };
    for (const [p, v] of Object.entries(user)) if (v?.trim()) add(p, { source: '网点', text: v.trim() });
    for (const f of findings) add(f.province, { source: '数据', text: f.text });
    if (book) {
      const byProv = new Map<string, Set<string>>();
      for (const sh of book.sheets) {
        for (const a of sh.specialAreas) {
          const city = a.split('：')[0];
          const p = CITY_TO_PROVINCE[city];
          if (!p) continue;
          const set = byProv.get(p) ?? new Set<string>();
          set.add(city);
          byProv.set(p, set);
        }
      }
      for (const [p, cities] of byProv) add(p, { source: '价格表', text: `${[...cities].join('、')} 在客户报价单里单独报价（特殊区域）` });
    }
    return out;
  }, [findings, book, user]);
}

export function useProvinceNote(): (province: string) => string | undefined {
  const notes = useAreaNotes();
  return useCallback((p: string) => {
    const list = notes.get(p);
    return list?.length ? list.map((n) => `【${n.source}】${n.text}`).join('；') : undefined;
  }, [notes]);
}

export function ProvMark({ province }: { province: string }) {
  const note = useProvinceNote()(province);
  if (!note) return null;
  return (
    <Tip label={NOTE_MARK}>
      <div className="tip-title">{province} · 特殊区域</div>
      <div className="tip-note">{note}</div>
      <div className="tip-note muted">只是提示，省份整体价格和统计不受影响。</div>
    </Tip>
  );
}

export function NotesEditor({ onClose }: { onClose: () => void }) {
  const { s, dispatch } = useStore();
  const [text, setText] = useState(notesToText(s.provinceNotes));
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="网点经验备注">
      <div className="modal">
        <h2>网点经验备注</h2>
        <p className="muted small">每行一条，格式「省份：备注」，记录网点知道的省内高成本城市、海岛等。数据分析和价格表里的特殊区域会自动加入，不需要在这里写。只做提示，不改变省份价格和统计；保存在本机浏览器。</p>
        <textarea className="notes-area" value={text} onChange={(e) => setText(e.target.value)} rows={10} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setText(notesToText(DEFAULT_PROVINCE_NOTES))}>恢复默认</button>
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: 'provinceNotes', notes: parseNotesText(text) }); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}

/** 当前数据涉及的特殊区域提示（放在流向、报价相关页面） */
export function ProvinceNoteList() {
  const { s } = useStore();
  const notes = useAreaNotes();
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const present = new Set(s.model?.provNames ?? []);
  const items = [...notes.entries()].filter(([p]) => present.has(p));
  return (
    <div className="province-notes span-2">
      <div className="pn-head">
        <span className="pn-title">{NOTE_MARK} 特殊区域提示（{items.length} 个省份）</span>
        <Tip>
          <div className="tip-title">特殊区域从哪里来</div>
          <div className="tip-row"><span>数据</span>同一省份 0.3–1kg 正常件中，派费比本省常见水平高 0.25 元以上的单占 1% 以上且摊到每票的额外派费 ≥ 0.015 元；或全省派费比各省常见水平高 0.15 元以上（偏远省份除外）。</div>
          <div className="tip-row"><span>价格表</span>客户报价单里单独报价的地市（如四川甘孜、阿坝、凉山）。</div>
          <div className="tip-row"><span>网点</span>网点经验备注，可编辑。</div>
          <div className="tip-note">导出没有城市字段，数据只能判断「省内有高成本地区」，具体城市需结合网点经验确认。这些只是提示，不改变省份价格。</div>
        </Tip>
        <button type="button" className="link no-export" onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</button>
        <button type="button" className="link no-export" onClick={() => setEdit(true)}>编辑网点备注</button>
      </div>
      {!open ? (
        <div className="pn-brief">{items.length ? items.map(([p]) => p).join('、') : '暂无'}</div>
      ) : (
        <ul className="pn-list">
          {items.map(([p, list]) => (
            <li key={p}><b>{p}</b>{list.map((n, k) => <span key={k} className="pn-note"><em className={`pn-src pn-${n.source}`}>{n.source}</em>{n.text}</span>)}</li>
          ))}
        </ul>
      )}
      {edit && <NotesEditor onClose={() => setEdit(false)} />}
    </div>
  );
}
