// 报价表展示：分区 × 重量段价格 + 续重规则 + 覆盖率。
import { fmtInt, fmtPct, fmtPrice } from '../app/format';
import { bandLabels } from '../engine/bands';
import { describeTail, ROUNDING_LABEL, type Quote } from '../engine/quote/types';
import { Tip } from './Tip';

export function QuoteTable({ q, showStats = true }: { q: Quote; showStats?: boolean }) {
  const labels = bandLabels(q.breakpoints).slice(0, q.breakpoints.length);
  const last = q.breakpoints[q.breakpoints.length - 1];
  return (
    <div className="tbl-wrap">
      <table className="tbl quote-tbl">
        <thead>
          <tr>
            <th>分区</th>
            <th className="prov-col">省份</th>
            {labels.map((l) => <th key={l} className="r">{l}kg</th>)}
            <th>续重（&gt;{last}kg 或首重以上）</th>
            {showStats && <th className="r">票数</th>}
            {showStats && <th className="r">覆盖率<Tip metric="coverage" /></th>}
          </tr>
        </thead>
        <tbody>
          {q.zones.map((z) => {
            const st = z.stats;
            const cov = st && st.tickets ? st.matched / st.tickets : NaN;
            return (
              <tr key={z.id}>
                <td className="nowrap"><b>{z.name}</b></td>
                <td className="prov-col">{z.provinces.join('、')}</td>
                {z.prices.map((p, i) => (
                  <td key={i} className={`r num price ${z.tail && q.breakpoints[i - 1] !== undefined && q.breakpoints[i - 1] >= z.tail.start ? 'muted' : ''}`}>
                    {z.tail && (i === 0 ? 0 : q.breakpoints[i - 1]) >= z.tail.start ? '续重' : fmtPrice(p)}
                  </td>
                ))}
                <td className="tail-cell">
                  {z.tail ? (
                    <>
                      {describeTail(z.tail)}
                      <span className="muted">（{ROUNDING_LABEL[z.tail.rounding]}）</span>
                      {st?.tailLowConfidence && (
                        <Tip label="⚠">
                          <div className="tip-title">续重规则置信度低</div>
                          <div className="tip-note">本分区重货样本太少（只有一个续重档位或重货同价），续重单价是参考同客户其他分区推断的，请对照正式报价单确认。</div>
                        </Tip>
                      )}
                      {st && st.tailSamples > 0 && <span className="muted small"> · {st.tailMatched}/{st.tailSamples} 单吻合</span>}
                    </>
                  ) : (
                    <span className="muted">无重货样本</span>
                  )}
                </td>
                {showStats && <td className="r num">{st ? fmtInt(st.tickets) : '—'}</td>}
                {showStats && <td className={`r num ${cov < 0.995 ? 'warn-text' : ''}`}>{fmtPct(cov, cov > 0.999 && cov < 1 ? 2 : 1)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
