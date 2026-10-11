// 客户价格表解析测试：用虚构的两种常见版式，不含真实客户数据。
import { describe, expect, it } from 'vitest';
import { coreName, matchSheetsToCustomers, parseQuoteSheet, provincesIn } from '../src/engine/quote/workbook';
import { zonePrice, type Quote } from '../src/engine/quote/types';

const S = (v: number | string | null) => (v === null ? '' : String(v));
const priceOf = (q: Quote, prov: string, w: number) => {
  const z = q.zones.find((z) => z.provinces.includes(prov))!;
  return zonePrice(z, w, q.breakpoints);
};

// 版式一：按省份逐行 + 新藏小表 + 备注
const LAYOUT_A: string[][] = [
  ['测试客户甲中通快递价格表'],
  ['城市', '0-1.2kg', '1.21-1.5kg', '1.51-2kg', '2.01-3kg', '3kg以上面单款', '3kg以上（0kg开始）'],
  ...[['浙江', 1], ['上海', 1], ['广东', 2], ['四川', 3]].map(([p, k]) => [p as string, '2.2', '2.8', '3.6', '4.6', '3', S(k as number)]),
  ['甘肃', '4.2', '4.8', '7.6', '9.6', '3', '5'],
  ['省份', '1KG以内', '', '', '1KG以上', '', ''],
  ['新疆', '15', '', '', '15', '', ''],
  ['西藏', '', '', '', '', '', ''],
  ['单号先付2.2元/单'],
  ['1.北京上海加收：1元/票'],
  ['2. 3kg以上(新疆西藏1kg以上)为首重价格+续重价格*整续重里，超出1kg部分向上取整计算'],
  ['2026.10.1日实施'],
];

// 版式二：省份分组 + 合并单元格 + 首重/续重
const LAYOUT_B: string[][] = [
  ['中通快递客户价格表'],
  ['测试客户乙'],
  ['省份', '重量≦1kg', '1kg＜重量≦1.5kg', '1.51kg<重量≦2kg', '首重', '续重'],
  ['浙江、安徽、上海、江苏', '2.3', '3.0', '4.0', '4.0', '1.0'],
  ['江西、山东、福建、广东、\n北京、天津', '', '', '', '', '2.5'],
  ['四川重庆山西陕西', '', '', '', '', '3.5'],
  ['甘肃、内蒙古、青海、宁夏', '6.0', '', '', '6.0', '6.0'],
  ['新疆、西藏', '15.0', '', '', '15.0', '15.0'],
  ['首重4元    2kg以上，价格=首重+（重量-1）*每公斤价格  例如：山东4kg,4+（4-1）*2.5=11.5元'],
  ['3.北京、上海件另加收1元/票。北京5KG以上续重加收1元/公斤。'],
  ['注：北京、上海+1   不提供包装袋'],
  ['2026.6.4实施'],
];

describe('价格表解析', () => {
  it('省份识别：分组、连写、别名、备注行', () => {
    expect(provincesIn('浙江、安徽、上海、江苏')).toEqual(['上海', '江苏', '浙江', '安徽']);
    expect(provincesIn('四川重庆河北')).toEqual(expect.arrayContaining(['四川', '重庆', '河北']));
    expect(provincesIn('江浙沪皖')).toHaveLength(4);
    expect(provincesIn('注：北京、上海+1   不提供包装袋')).toEqual([]);
    expect(provincesIn('单号先付2.2元/单')).toEqual([]);
  });

  it('版式一：重量段、面单款续重、京沪加收、新藏小表、生效日', () => {
    const r = parseQuoteSheet('测试客户甲', LAYOUT_A.map((row) => row.map(S)));
    expect(r.warnings.filter((w) => !w.startsWith('只识别到'))).toEqual([]);
    const q = r.quote!;
    expect(q.breakpoints).toEqual([1.2, 1.5, 2, 3]);
    expect(r.sheetFee).toBe(2.2);
    expect(r.effectiveFrom).toBe('2026-10-01');
    expect(priceOf(q, '浙江', 1.2)).toBe(2.2);
    expect(priceOf(q, '浙江', 1.21)).toBe(2.8);
    expect(priceOf(q, '上海', 0.8)).toBe(3.2); // 加收 1 元
    expect(priceOf(q, '浙江', 3.6)).toBe(7); // 3 + 1 × ⌈3.6⌉
    expect(priceOf(q, '广东', 3.6)).toBe(11); // 3 + 2 × 4
    expect(priceOf(q, '四川', 5)).toBe(18);
    expect(priceOf(q, '新疆', 0.9)).toBe(15);
    expect(priceOf(q, '新疆', 1.13)).toBe(30); // 首重 15 + 续重 15 × ⌈0.13⌉
    expect(priceOf(q, '西藏', 2.5)).toBe(45); // 合并单元格继承新疆
  });

  it('版式二：合并单元格、首重+(重量-1)×续重、备注里的加收', () => {
    const r = parseQuoteSheet('测试客户乙', LAYOUT_B.map((row) => row.map(S)));
    const q = r.quote!;
    expect(q.breakpoints).toEqual([1, 1.5, 2]);
    expect(r.effectiveFrom).toBe('2026-06-04');
    expect(priceOf(q, '浙江', 0.9)).toBe(2.3);
    expect(priceOf(q, '广东', 1.4)).toBe(3); // 继承上一行重量段价格
    expect(priceOf(q, '山东', 4)).toBe(11.5); // 4 + (4 - 1) × 2.5，与报价单例子一致
    expect(priceOf(q, '重庆', 3)).toBe(11); // 4 + 2 × 3.5
    expect(priceOf(q, '北京', 0.9)).toBe(3.3);
    expect(priceOf(q, '甘肃', 2.2)).toBe(6 + 6 * 2);
    expect(priceOf(q, '新疆', 1.5)).toBe(30);
    expect(r.warnings.some((w) => w.includes('5KG以上续重加收'))).toBe(true);
  });

  it('客户名匹配', () => {
    expect(coreName('陈某某K1')).toBe('陈某某');
    expect(coreName('张某（某某鞋业）')).toBe('张某');
    const { assign, weak } = matchSheetsToCustomers(['张某', '李某（甲品牌）', '王某某'], ['张某K2', '甲品牌', '王某某CK', '赵某']);
    expect(assign).toEqual({ 张某K2: '张某', 甲品牌: '李某（甲品牌）', 王某某CK: '王某某' });
    expect(weak).toEqual(['甲品牌']);
  });
});
