// 特殊区域备注：省内个别城市/海岛成本异常时，以「⚑」标记 + 提示的方式出现，不改动省份价格。
import { useCallback, useState } from 'react';
import { useDerived, useStore } from '../app/store';
import { DEFAULT_PROVINCE_NOTES, noteOf, notesToText, parseNotesText } from '../engine/notes';
import { Tip } from './Tip';

export const NOTE_MARK = '⚑';

export function useProvinceNote(): (province: string) => string | undefined {
  const { s } = useStore();
  const notes = s.provinceNotes;
  return useCallback((p: string) => noteOf(notes, p), [notes]);
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
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="特殊区域备注">
      <div className="modal">
        <h2>特殊区域备注</h2>
        <p className="muted small">每行一条，格式「省份：备注」。用于提示省内个别城市、海岛的成本异常（如深圳、广州派费高，舟山海岛需转运）。只做提示，不改变整个省份的价格和统计。保存在本机浏览器。</p>
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
  const d = useDerived();
  const [edit, setEdit] = useState(false);
  const present = new Set(d?.model.provNames ?? []);
  const items = Object.entries(s.provinceNotes).filter(([p, v]) => v && present.has(p));
  return (
    <div className="province-notes span-2">
      <span className="pn-title">{NOTE_MARK} 特殊区域提示</span>
      {items.length ? items.map(([p, v]) => <span key={p} className="pn-item"><b>{p}</b>：{v}</span>) : <span className="muted">暂无</span>}
      <button type="button" className="link no-export" onClick={() => setEdit(true)}>编辑</button>
      {edit && <NotesEditor onClose={() => setEdit(false)} />}
    </div>
  );
}
