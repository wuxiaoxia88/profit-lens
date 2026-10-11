// 标准字段定义：把各种导出表头统一映射到内部字段 id。
// 新增别名时只需在 aliases 里追加，越靠前优先级越高。

export type FieldKind = 'num' | 'dict' | 'date' | 'id';

export interface FieldDef {
  id: FieldId;
  label: string;
  kind: FieldKind;
  aliases: string[];
  group: 'base' | 'income' | 'cost';
}

export type NumField =
  | 'weight'
  | 'profit'
  | 'income'
  | 'cost'
  | 'inTransfer'
  | 'inSheet'
  | 'inVA'
  | 'cTransfer'
  | 'cDispatch'
  | 'cSheet'
  | 'cVA'
  | 'cPolicy';

export type DictField =
  | 'customerType'
  | 'customer'
  | 'customerCode'
  | 'accountName'
  | 'account'
  | 'bizType'
  | 'dest'
  | 'signStatus'
  | 'returned'
  | 'selfSign'
  | 'shipped';

export type DateField = 'date' | 'signDate';
export type IdField = 'waybill';
export type FieldId = NumField | DictField | DateField | IdField;

export const FIELDS: FieldDef[] = [
  { id: 'date', label: '揽收日期', kind: 'date', group: 'base', aliases: ['网点揽收日期', '揽收日期', '揽收时间', '寄件日期', '发件日期', '日期'] },
  { id: 'waybill', label: '运单号', kind: 'id', group: 'base', aliases: ['运单号', '单号', '运单编号', '快递单号'] },
  { id: 'customerType', label: '结算对象类型', kind: 'dict', group: 'base', aliases: ['结算对象类型', '客户类型'] },
  { id: 'customer', label: '结算对象', kind: 'dict', group: 'base', aliases: ['结算对象', '客户名称', '客户', '结算客户'] },
  { id: 'customerCode', label: '结算对象编码', kind: 'dict', group: 'base', aliases: ['结算对象编码', '客户编码', '客户编号'] },
  { id: 'accountName', label: '面单账号名称', kind: 'dict', group: 'base', aliases: ['面单账号名称', '店铺名称', '账号名称'] },
  { id: 'account', label: '面单账号', kind: 'dict', group: 'base', aliases: ['面单账号', '电子面单账号', '账号'] },
  { id: 'bizType', label: '业务类型', kind: 'dict', group: 'base', aliases: ['业务数据-业务类型', '业务类型'] },
  { id: 'dest', label: '目的地', kind: 'dict', group: 'base', aliases: ['业务数据-目的地', '目的地', '目的省份', '目的省', '收件省份', '到达省份', '省份'] },
  { id: 'weight', label: '结算重量', kind: 'num', group: 'base', aliases: ['业务数据-结算重量', '结算重量', '计费重量', '重量', '实际重量'] },
  { id: 'signDate', label: '签收日期', kind: 'date', group: 'base', aliases: ['业务数据-签收日期', '签收日期', '签收时间'] },
  { id: 'signStatus', label: '签收状态', kind: 'dict', group: 'base', aliases: ['业务数据-签收状态', '签收状态'] },
  { id: 'returned', label: '退件', kind: 'dict', group: 'base', aliases: ['业务数据-退件', '退件', '是否退件'] },
  { id: 'selfSign', label: '自发自签', kind: 'dict', group: 'base', aliases: ['业务数据-自发自签', '自发自签', '是否自发自签'] },
  { id: 'shipped', label: '是否已发货', kind: 'dict', group: 'base', aliases: ['业务数据-是否已发货', '是否已发货', '是否发货'] },
  { id: 'profit', label: '利润', kind: 'num', group: 'base', aliases: ['利润', '毛利', '毛利润'] },
  { id: 'income', label: '收入', kind: 'num', group: 'income', aliases: ['收入', '发件收入', '总收入'] },
  { id: 'cost', label: '成本', kind: 'num', group: 'cost', aliases: ['成本', '发件成本', '总成本'] },
  { id: 'inTransfer', label: '中转收入', kind: 'num', group: 'income', aliases: ['发件收入-中转收入', '中转收入'] },
  { id: 'inSheet', label: '面单收入', kind: 'num', group: 'income', aliases: ['发件收入-面单收入', '面单收入'] },
  { id: 'inVA', label: '增值收入', kind: 'num', group: 'income', aliases: ['发件收入-增值收入', '增值收入'] },
  { id: 'cTransfer', label: '中转成本', kind: 'num', group: 'cost', aliases: ['发件成本-中转成本', '中转成本'] },
  { id: 'cDispatch', label: '派费成本', kind: 'num', group: 'cost', aliases: ['发件成本-派费成本', '派费成本'] },
  { id: 'cSheet', label: '面单成本', kind: 'num', group: 'cost', aliases: ['发件成本-面单成本', '面单成本'] },
  { id: 'cVA', label: '增值成本', kind: 'num', group: 'cost', aliases: ['发件成本-增值成本', '增值成本'] },
  { id: 'cPolicy', label: '政策费用', kind: 'num', group: 'cost', aliases: ['发件成本-政策费用', '政策费用', '政策成本'] },
];

export const FIELD_BY_ID: Record<FieldId, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.id, f])) as Record<FieldId, FieldDef>;

export const NUM_FIELDS = FIELDS.filter((f) => f.kind === 'num').map((f) => f.id as NumField);
export const DICT_FIELDS = FIELDS.filter((f) => f.kind === 'dict').map((f) => f.id as DictField);
export const DATE_FIELDS = FIELDS.filter((f) => f.kind === 'date').map((f) => f.id as DateField);

/** 列映射：内部字段 → 源文件列序号（0 起）。 */
export type ColumnMapping = Partial<Record<FieldId, number>>;

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '').toLowerCase();

/** 根据表头自动识别字段。精确匹配优先，其次是别名包含关系。 */
export function autoMap(headers: string[]): ColumnMapping {
  const normed = headers.map((h) => norm(String(h ?? '')));
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  // 第一轮：精确匹配（按别名优先级）
  for (const f of FIELDS) {
    for (const alias of f.aliases) {
      const idx = normed.findIndex((h, i) => !used.has(i) && h === norm(alias));
      if (idx >= 0) {
        mapping[f.id] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // 第二轮：表头以「-别名」结尾（如「业务数据-目的地」）
  for (const f of FIELDS) {
    if (mapping[f.id] !== undefined) continue;
    for (const alias of f.aliases) {
      const a = norm(alias);
      if (a.length < 2) continue;
      const idx = normed.findIndex((h, i) => !used.has(i) && (h.endsWith('-' + a) || h.endsWith('_' + a)));
      if (idx >= 0) {
        mapping[f.id] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

/** 判断一行是否像表头：至少命中 3 个已知别名。 */
export function looksLikeHeader(row: string[]): boolean {
  const m = autoMap(row);
  return Object.keys(m).length >= 3;
}

export interface Capabilities {
  /** 有目的地和重量：可做流向、重量段结构分析 */
  structure: boolean;
  income: boolean;
  cost: boolean;
  profit: boolean;
  /** 可还原报价（需要运费价格口径） */
  quote: boolean;
  incomeParts: boolean;
  costParts: boolean;
}

export function capabilitiesOf(fields: Set<FieldId>): Capabilities {
  const has = (...ids: FieldId[]) => ids.every((i) => fields.has(i));
  const income = has('income') || has('inTransfer', 'inSheet');
  const cost = has('cost') || has('cTransfer', 'cDispatch', 'cSheet');
  return {
    structure: has('dest', 'weight'),
    income,
    cost,
    profit: has('profit') || (income && cost),
    quote: has('dest', 'weight') && (has('inSheet') || has('inTransfer') || has('income')),
    incomeParts: has('inTransfer', 'inSheet'),
    costParts: has('cTransfer', 'cDispatch', 'cSheet'),
  };
}
