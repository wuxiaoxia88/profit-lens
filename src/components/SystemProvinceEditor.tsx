// 「以系统为准」的省份：价格表可能没及时同步（如北京加收），这些省份偏离报价不计多收/少收。
import { useState } from 'react';
import { useStore } from '../app/store';
import { Tip } from './Tip';

export function SystemProvinceEditor() {
  const { s, dispatch } = useStore();
  const [text, setText] = useState(s.systemProvinces.join('、'));
  const save = () => dispatch({ type: 'systemProvinces', provinces: [...new Set(text.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean))] });
  return (
    <span className="sys-prov no-export">
      以系统收费为准的省份：
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="以系统收费为准的省份" />
      <Tip>
        <div className="tip-title">以系统收费为准</div>
        <div className="tip-note">这些省份的报价单可能没有及时同步（如北京加收），核对时偏离报价的单记为「以系统为准」，不计入多收/少收，也算作一致。多个省份用顿号分隔，保存在本机。</div>
      </Tip>
    </span>
  );
}
