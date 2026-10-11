import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseNumberBytes } from '../src/engine/builder';
import { generateDemo } from '../src/engine/demo';
import { loadFiles, probeFile } from '../src/engine/load';
import { applyFilters, buildModel, DEFAULT_FILTERS, aggregate } from '../src/engine/model';
import { bandIndex, bandLabels, parseBreakpoints } from '../src/engine/bands';
import { inferQuote } from '../src/engine/quote/infer';
import { checkQuote, simulateQuote } from '../src/engine/quote/check';
import { quoteToRows, rowsToQuote } from '../src/engine/quote/template';
import { detectPricePeriods } from '../src/engine/quote/periods';
import { writeXlsx } from '../src/engine/xlsxWriter';
import { normalizeProvince } from '../src/engine/regions';
import { autoMap } from '../src/engine/schema';
import { waybillAt } from '../src/engine/dataset';

const HEADERS = ['网点揽收日期', '运单号', '结算对象', '面单账号', '业务数据-目的地', '业务数据-结算重量', '利润', '收入', '成本', '发件收入-中转收入', '发件收入-面单收入'];

describe('数字解析', () => {
  it('与 Number() 结果完全一致', () => {
    for (const s of ['1.107', '-1.107', '0.1', '1.91', '22.16', '0', '0.0', '1,234.5', '  2.2 ', '1e3']) {
      const b = strToU8(s);
      expect(parseNumberBytes(b, 0, b.length)).toBe(Number(s.replace(/,/g, '').trim()));
    }
    const e = strToU8('');
    expect(parseNumberBytes(e, 0, 0)).toBeNaN();
  });
});

describe('字段识别', () => {
  it('识别系统导出表头', () => {
    const m = autoMap(HEADERS);
    expect(m.dest).toBe(4);
    expect(m.weight).toBe(5);
    expect(m.income).toBe(7);
    expect(m.inTransfer).toBe(9);
  });
  it('省份标准化', () => {
    expect(normalizeProvince('浙江省')).toBe('浙江');
    expect(normalizeProvince('广西壮族自治区')).toBe('广西');
    expect(normalizeProvince('上海市')).toBe('上海');
    expect(normalizeProvince('浙江省杭州市')).toBe('浙江');
  });
});

describe('重量段', () => {
  it('左开右闭', () => {
    const b = [1.2, 1.5, 2];
    expect(bandIndex(1.2, b)).toBe(0);
    expect(bandIndex(1.21, b)).toBe(1);
    expect(bandIndex(2.5, b)).toBe(3);
    expect(bandLabels(b)).toEqual(['≤1.2', '1.2–1.5', '1.5–2', '>2']);
    expect(parseBreakpoints('2, 0.5，1 1')).toEqual([0.5, 1, 2]);
    expect(parseBreakpoints('a')).toBeNull();
  });
});

describe('XLSX / CSV 导入', () => {
  const rows = [
    ['2026-10-01', '79000000000001', '客户A', 'PDD_1', '浙江', 0.8, 0.5, 2.2, 1.7, 0, 2.2],
    ['2026-10-02', '79000000000002', '客户A', 'PDD_1', '新疆维吾尔自治区', 1.13, 3, 16.95, 13.95, 14.75, 2.2],
    ['2026-10-02', '79000000000003', '客户A&B', 'PDD_2', '北京', 1.6, -0.2, 4.6, 4.8, 2.4, 2.2],
  ];
  it('内联字符串 xlsx', async () => {
    const bytes = writeXlsx([{ name: 'sheet1', rows: [['某网点发件盈亏分析'], HEADERS, ...rows] }]);
    const blob = new Blob([bytes]);
    const probe = await probeFile(blob, 't.xlsx');
    expect(probe.headerRow).toBe(1);
    const d = await loadFiles([{ file: blob, probe }]);
    expect(d.n).toBe(3);
    expect(Array.from(d.num.weight!)).toEqual([0.8, 1.13, 1.6]);
    expect(d.dict.customer!.values[d.dict.customer!.codes[2]]).toBe('客户A&B');
    expect(waybillAt(d, 1)).toBe('79000000000002');
    const m = buildModel(d);
    expect(m.provNames).toContain('新疆');
  });
  it('共享字符串 xlsx', async () => {
    const sst = ['日期', '目的地', '重量', '收入', '浙江', '江苏'];
    const files = {
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst>' + sst.map((s) => `<si><t>${s}</t></si>`).join('') + '</sst>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
          '<row r="2"><c r="A2"><v>46296</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>0.5</v></c><c r="D2"><f>1+1.2</f><v>2.2</v></c></row>' +
          '<row r="3"><c r="A3"><v>46297</v></c><c r="B3" t="s"><v>5</v></c><c r="D3"><v>3</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    };
    const blob = new Blob([zipSync(files)]);
    const probe = await probeFile(blob, 's.xlsx');
    const d = await loadFiles([{ file: blob, probe }]);
    expect(d.n).toBe(2);
    expect(d.dict.dest!.values[d.dict.dest!.codes[1]]).toBe('江苏');
    expect(d.num.income![0]).toBe(2.2);
    expect(d.num.weight![1]).toBeNaN();
    expect(d.dates.date![0]).toBe(46296 - 25569);
  });
  it('GBK 编码 CSV（含引号）', async () => {
    // 「目的地,重量,收入」+「"浙江",1.5,"2,2"」以 GBK 编码
    const head = [0xc4, 0xbf, 0xb5, 0xc4, 0xb5, 0xd8, 0x2c, 0xd6, 0xd8, 0xc1, 0xbf, 0x2c, 0xca, 0xd5, 0xc8, 0xeb, 0x0d, 0x0a];
    const zj = [0x22, 0xd5, 0xe3, 0xbd, 0xad, 0x22, 0x2c, 0x31, 0x2e, 0x35, 0x2c, 0x22, 0x32, 0x2e, 0x32, 0x22, 0x0a];
    const blob = new Blob([new Uint8Array([...head, ...zj])]);
    const probe = await probeFile(blob, 'g.csv');
    expect(probe.format).toBe('csv');
    expect(probe.headers).toEqual(['目的地', '重量', '收入']);
    const d = await loadFiles([{ file: blob, probe }]);
    expect(d.n).toBe(1);
    expect(d.dict.dest!.values[d.dict.dest!.codes[0]]).toBe('浙江');
    expect(d.num.income![0]).toBe(2.2);
  });
});

describe('报价还原（示例数据）', () => {
  const data = generateDemo(30000);
  const m = buildModel(data);
  const { mask } = applyFilters(m, DEFAULT_FILTERS);
  const r = inferQuote(m, mask);
  const zoneOf = (p: string) => r.quote.zones.find((z) => z.provinces.includes(p))!;

  it('识别出重量段断点与分区价格', () => {
    expect(r.quote.breakpoints).toEqual([1.2, 1.5, 2, 3]);
    expect(r.coverage).toBeGreaterThan(0.998);
    expect(zoneOf('河南').prices).toEqual([2.3, 2.9, 3.7, 4.7]);
    expect(zoneOf('北京').prices).toEqual([3.3, 3.9, 4.7, 5.7]);
    expect(zoneOf('甘肃').prices.slice(0, 3)).toEqual([4.3, 4.9, 7.7]);
    expect(r.quote.sheetFee).toBe(2.3);
  });
  it('新疆/西藏：首重 1kg + 按实重续重', () => {
    const z = zoneOf('新疆');
    expect(z.tail).toMatchObject({ start: 1, base: 16, perKg: 15, rounding: 'exact' });
  });
  it('江浙皖：3kg 以上每 kg 1 元', () => {
    const z = zoneOf('浙江');
    expect(z.tail).toMatchObject({ start: 3, perKg: 1, rounding: 'ceil' });
  });
  it('核对能找出异常单', () => {
    const c = checkQuote(m, r.quote, mask);
    expect(c.total.over + c.total.under).toBeGreaterThan(0);
    expect(c.total.match / c.total.n).toBeGreaterThan(0.998);
  });
  it('模板往返不丢信息', () => {
    const rows = quoteToRows(r.quote).map((row) => row.map((v) => (v === null || v === undefined ? '' : String(v))));
    const q2 = rowsToQuote(rows, '往返');
    expect(q2.breakpoints).toEqual(r.quote.breakpoints);
    expect(q2.zones.map((z) => z.prices)).toEqual(r.quote.zones.map((z) => z.prices));
    expect(q2.zones.map((z) => z.tail)).toEqual(r.quote.zones.map((z) => z.tail));
    const c = checkQuote(m, q2, mask);
    expect(c.total.match).toBe(checkQuote(m, r.quote, mask).total.match);
  });
  it('调价模拟：全线 +0.1 元，毛利增加 0.1 × 票数', () => {
    const q = structuredClone(r.quote);
    q.zones.forEach((z) => { z.prices = z.prices.map((p) => (p === null ? null : Math.round((p + 0.1) * 100) / 100)); if (z.tail) z.tail.base += 0.1; });
    const s0 = simulateQuote(m, r.quote, mask);
    const s1 = simulateQuote(m, q, mask);
    const priced = s1.cells.slice(0, -1).flat().reduce((a, c) => a + c.n, 0);
    expect(s1.total.newProfit - s0.total.newProfit).toBeCloseTo(0.1 * priced, 0);
  });
  it('分组聚合与总数一致', () => {
    const all = aggregate(m, mask, null, 1);
    const byProv = aggregate(m, mask, m.prov, m.provNames.length);
    expect(byProv.n.reduce((a, b) => a + b, 0)).toBe(all.n[0]);
    expect(byProv.sum.profit!.reduce((a, b) => a + b, 0)).toBeCloseTo(all.sum.profit![0], 6);
  });
});

describe('调价识别', () => {
  it('中途调价拆成两个时段', () => {
    const d = generateDemo(20000, 7);
    const day = d.dates.date!;
    const mid = Math.floor(Date.UTC(2026, 8, 16) / 86400000);
    for (let i = 0; i < d.n; i++) if (day[i] >= mid) { d.num.inSheet![i] -= 0.2; }
    const m = buildModel(d);
    const { mask } = applyFilters(m, DEFAULT_FILTERS);
    const ps = detectPricePeriods(m, mask);
    expect(ps.length).toBe(2);
    expect(ps[1].from).toBe(mid);
  });
});
