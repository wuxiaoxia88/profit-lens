// 分析用重量段设置：默认取报价还原出的断点，用户可自定义（自动保存在本机）。
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { bandLabels, DEFAULT_BREAKPOINTS, parseBreakpoints } from '../engine/bands';
import { Tip } from '../components/Tip';

export function BandEditor() {
  const { s, dispatch } = useStore();
  const current = s.bandsOverride ?? s.autoBands;
  const [text, setText] = useState(current.join(', '));
  const [err, setErr] = useState(false);
  useEffect(() => setText(current.join(', ')), [current]);
  const apply = (v: string) => {
    const b = parseBreakpoints(v);
    setErr(!b);
    if (b) dispatch({ type: 'bands', bands: b });
  };
  return (
    <div className="band-editor span-2 no-export">
      <span className="be-label">
        重量段
        <Tip>
          <div className="tip-title">分析用重量段</div>
          <div className="tip-row"><span>规则</span>输入分界点（kg），区间「左开右闭」：1.2kg 属于「≤1.2」段。</div>
          <div className="tip-note">单个客户的数据默认使用从其报价还原出的分界点，分析结果与报价一一对应；多个客户的数据默认使用网点价格表最常用的分界（0.5、1、1.2、1.5、2、3、5、10）。修改会自动保存在本机浏览器。</div>
        </Tip>
      </span>
      <input
        className={err ? 'err' : ''}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply(text)}
        onBlur={() => apply(text)}
        aria-label="重量段分界点"
        placeholder="例如 0.5, 1, 2, 3"
      />
      <span className="be-preview">{bandLabels(current).join('　')}</span>
      <button type="button" className="link" onClick={() => dispatch({ type: 'bands', bands: null })}>默认分段</button>
      <button type="button" className="link" onClick={() => dispatch({ type: 'bands', bands: DEFAULT_BREAKPOINTS })}>常用分段</button>
    </div>
  );
}
