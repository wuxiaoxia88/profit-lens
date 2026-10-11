// 数据质检：字段识别、勾稽校验、异常单统计。帮用户判断这份导出能不能放心用。
import { useMemo } from 'react';
import { fmtInt, fmtPct } from '../app/format';
import { useDerived, useStore } from '../app/store';
import { Card } from '../components/Card';
import { NO_DATE, waybillAt } from '../engine/dataset';
import { provinceInfo } from '../engine/regions';
import { FIELDS } from '../engine/schema';

interface CheckItem { name: string; ok: boolean; count: number; detail: string; info?: boolean }

export function QualityPage() {
  const d = useDerived()!;
  const { s } = useStore();
  const m = d.model;
  const caps = m.caps;

  const checks = useMemo(() => {
    const n = m.n;
    const num = m.data.num;
    const out: CheckItem[] = [];
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
    const count = (fn: (i: number) => boolean) => { let c = 0; for (let i = 0; i < n; i++) if (fn(i)) c++; return c; };
    if (num.income && num.inTransfer && num.inSheet && num.inVA) {
      const c = count((i) => !near(num.income![i], (num.inTransfer![i] || 0) + (num.inSheet![i] || 0) + (num.inVA![i] || 0)));
      out.push({ name: '收入勾稽', ok: c === 0, count: c, detail: '收入 = 中转收入 + 面单收入 + 增值收入' });
    }
    if (num.cost && num.cTransfer && num.cDispatch && num.cSheet) {
      const c = count((i) => !near(num.cost![i], ['cTransfer', 'cDispatch', 'cSheet', 'cVA', 'cPolicy'].reduce((a, k) => a + (num[k as 'cVA']?.[i] || 0), 0)));
      out.push({ name: '成本勾稽', ok: c === 0, count: c, detail: '成本 = 中转 + 派费 + 面单 + 增值 + 政策' });
    }
    if (num.profit && num.income && num.cost) {
      const c = count((i) => !near(num.profit![i], (num.income![i] || 0) - (num.cost![i] || 0)));
      out.push({ name: '利润勾稽', ok: c === 0, count: c, detail: '利润 = 收入 − 成本' });
    }
    if (m.cols.weight) {
      const w = m.cols.weight;
      const c = count((i) => !(w[i] > 0));
      out.push({ name: '重量为 0 或缺失', ok: c === 0, count: c, detail: '这些单无法归入重量段，报价核对时自动跳过' });
    }
    if (m.cols.price && caps.quote) {
      const p = m.cols.price;
      const c = count((i) => !(p[i] > 0));
      out.push({ name: '运费为 0', ok: c === 0, count: c, detail: '面单收入 + 中转收入为 0，常见于作废单或特殊结算' });
    }
    if (m.data.dict.dest) {
      const bad = m.provNames.map((p) => !provinceInfo(p));
      const c = count((i) => bad[m.prov[i]]);
      const names = m.provNames.filter((_, i) => bad[i]);
      out.push({ name: '目的地无法识别为省份', ok: c === 0, count: c, detail: names.length ? `出现的值：${names.slice(0, 8).join('、')}` : '全部识别为省级行政区' });
    }
    if (m.day) {
      const c = count((i) => m.day![i] === NO_DATE);
      out.push({ name: '揽收日期缺失', ok: c === 0, count: c, detail: '缺日期的单在按日期筛选时会被排除' });
    }
    if (m.data.waybill) {
      const seen = new Set<string>();
      let dup = 0;
      for (let i = 0; i < n; i++) { const w = waybillAt(m.data, i); if (!w) continue; if (seen.has(w)) dup++; else seen.add(w); }
      out.push({ name: '运单号重复', ok: dup === 0, count: dup, detail: dup ? '可能重复导入了同一个文件或时间段重叠' : '没有重复' });
    }
    const triInfo = (field: 'returned' | 'selfSign' | 'shipped', label: string, yes: RegExp) => {
      const col = m.data.dict[field];
      if (!col) return;
      const isYes = col.values.map((v) => yes.test(v));
      const c = count((i) => isYes[col.codes[i]]);
      out.push({ name: label, ok: true, info: true, count: c, detail: '仅提示，可在筛选条中排除' });
    };
    triInfo('returned', '退件', /^是$/);
    triInfo('selfSign', '自发自签', /^是$/);
    triInfo('shipped', '未发货', /未/);
    return out;
  }, [m, caps.quote]);

  return (
    <div className="grid">
      <Card title="导入的文件" exportName="导入文件">
        <table className="tbl compact">
          <thead><tr><th>文件</th><th>格式</th><th className="r">行数</th></tr></thead>
          <tbody>{m.data.sources.map((x, i) => <tr key={i}><td>{x.fileName}</td><td>{x.format}</td><td className="r num">{fmtInt(x.rows)}</td></tr>)}</tbody>
        </table>
        <p className="muted small">合计 {fmtInt(m.n)} 行{s.loadMs ? `，导入耗时 ${(s.loadMs / 1000).toFixed(1)} 秒` : ''}。运费口径：{m.priceBasis === 'sheet+transfer' ? '面单收入 + 中转收入' : m.priceBasis === 'income-va' ? '收入 − 增值收入' : '收入'}。</p>
      </Card>
      <Card title="可用功能" exportName="可用功能">
        <ul className="caps">
          <li className={caps.structure ? 'ok' : 'no'}>流向、重量段结构分析</li>
          <li className={caps.income ? 'ok' : 'no'}>收入分析</li>
          <li className={caps.cost ? 'ok' : 'no'}>成本分析</li>
          <li className={caps.profit ? 'ok' : 'no'}>利润（毛利/纯利）分析</li>
          <li className={caps.quote ? 'ok' : 'no'}>报价还原与核对、调价模拟</li>
          <li className={caps.costParts ? 'ok' : 'no'}>成本构成拆解</li>
        </ul>
      </Card>
      <Card title="数据检查" span={2} exportName="数据检查">
        <table className="tbl">
          <thead><tr><th>检查项</th><th>结果</th><th className="r">单数</th><th className="r">占比</th><th>说明</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.info ? <span className="badge b-info">提示</span> : c.ok ? <span className="badge b-0">✓ 通过</span> : <span className="badge b-3">⚠ 需关注</span>}</td>
                <td className="r num">{fmtInt(c.count)}</td>
                <td className="r num">{fmtPct(c.count / Math.max(1, m.n), 2)}</td>
                <td className="muted">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="字段识别" span={2} exportName="字段识别">
        <div className="field-grid">
          {FIELDS.map((f) => (
            <span key={f.id} className={m.fields.has(f.id) ? 'ok' : 'no'}>{m.fields.has(f.id) ? '✓' : '—'} {f.label}</span>
          ))}
        </div>
        <p className="muted small">缺少的字段不影响其他功能。字段名与系统导出不一致时，导入时会弹出「确认字段对应」让你手动选择。</p>
      </Card>
    </div>
  );
}
