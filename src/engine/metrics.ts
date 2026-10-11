// 指标口径注册表：界面上每个关键数字旁的「ⓘ」角标都从这里取说明，保证口径只写一处。
// 来源说明摘自网点盈亏分析系统的字段口径。

export interface MetricDef {
  id: string;
  label: string;
  formula: string;
  source: string;
  note?: string;
}

const SRC_INCOME = '神州 - 财务工作台 - 发件费用账单';
const SRC_COST = '网点发件过程中网点承担的费用（盈亏分析系统「发件成本」）';

export const METRICS: Record<string, MetricDef> = {
  tickets: { id: 'tickets', label: '票数', formula: '筛选范围内的运单数量', source: '导入的单号明细，每行一单' },
  income: {
    id: 'income', label: '收入（发件收入）',
    formula: '中转收入 + 面单收入 + 增值收入',
    source: SRC_INCOME,
    note: '使用导出文件里的「收入」列；若无该列，则由三项明细相加。',
  },
  cost: {
    id: 'cost', label: '成本（发件成本）',
    formula: '中转成本 + 派费成本 + 面单成本 + 增值成本 + 政策费用',
    source: SRC_COST,
    note: '使用「成本」列；若无该列，则由五项明细相加。政策费用为负数时表示补贴。',
  },
  profit: {
    id: 'profit', label: '毛利',
    formula: '收入 − 成本（即系统「利润」字段）',
    source: '网点发件盈亏分析系统',
    note: '只是系统毛利，不含网点线下操作与管理成本。',
  },
  margin: { id: 'margin', label: '毛利率', formula: '毛利 ÷ 收入', source: '由收入、毛利计算' },
  unitIncome: { id: 'unitIncome', label: '单票收入', formula: '收入 ÷ 票数', source: '由收入、票数计算' },
  unitCost: { id: 'unitCost', label: '单票成本', formula: '成本 ÷ 票数', source: '由成本、票数计算' },
  unitProfit: { id: 'unitProfit', label: '单票毛利', formula: '毛利 ÷ 票数', source: '由毛利、票数计算' },
  opCost: {
    id: 'opCost', label: '线下操作管理成本',
    formula: '元/票 × 票数 + 固定总额（固定总额按票数比例分摊到各流向、重量段）',
    source: '由使用者在页面顶部自行设置，系统数据中不包含',
    note: '包括装卸、分拣人工、场地、管理人员、水电等网点自担的费用，每个网点不同。',
  },
  net: {
    id: 'net', label: '纯利（估算）',
    formula: '毛利 − 线下操作管理成本',
    source: '毛利来自系统；线下成本来自页面设置',
    note: '纯利的准确性取决于线下成本设置是否贴近实际。',
  },
  unitNet: { id: 'unitNet', label: '单票纯利', formula: '纯利 ÷ 票数', source: '由纯利、票数计算' },
  lossShare: { id: 'lossShare', label: '亏损票占比', formula: '毛利 < 0 的票数 ÷ 票数', source: '逐单判断系统「利润」字段' },
  avgWeight: { id: 'avgWeight', label: '平均结算重量', formula: 'Σ结算重量 ÷ 票数', source: '「业务数据-结算重量」' },
  price: {
    id: 'price', label: '运费单价（报价口径）',
    formula: '面单收入 + 中转收入（不含增值收入）',
    source: SRC_INCOME,
    note: '这是客户实际按报价支付的运费，用于还原和核对报价。增值费（退件、保价等）另计，不参与报价核对。',
  },
  inTransfer: {
    id: 'inTransfer', label: '中转收入',
    formula: '发件应结金额 + 汇总计费的中转费',
    source: SRC_INCOME,
    note: '发件应结金额取发件费用账单「应结金额」；汇总计费中转费为分层报价、计费模式「有/无指标-汇总计费」的日/月账单费用。',
  },
  inSheet: { id: 'inSheet', label: '面单收入', formula: '发件费用账单 - 单号明细面单费（收入 - 预收）', source: SRC_INCOME },
  inVA: {
    id: 'inVA', label: '增值收入',
    formula: '退件费、拦截费、代收货款手续费、到付款手续费、保价费、回单费、好快/标快费用中已向下结算收取的部分',
    source: SRC_INCOME,
    note: '含已线上、线下和部分结算的费用。',
  },
  cTransfer: {
    id: 'cTransfer', label: '中转成本',
    formula: '中转费成本 − 中转费密度返利 + 旺季中转费 + 建包费 + 扫描费 + 包月费 + 操作费 + 装车费 + 卸车费',
    source: SRC_COST,
  },
  cDispatch: {
    id: 'cDispatch', label: '派费成本',
    formula: '基础派费 + 续重派费 + 区域加收派费 + 二级中转费 − 二级中转费密度返利 + 增值派费',
    source: SRC_COST,
  },
  cSheet: { id: 'cSheet', label: '面单成本', formula: '面单购买成本', source: SRC_COST },
  cVA: {
    id: 'cVA', label: '增值成本',
    formula: '代收到付款手续费 + 到付款手续费 + 退件费 + 拦截费 + 保价费 + 好快/标快费用 + 回单费',
    source: SRC_COST,
  },
  cPolicy: {
    id: 'cPolicy', label: '政策费用',
    formula: '中转费政策 + 面单政策 + 业务治理政策 + 其他政策',
    source: SRC_COST,
    note: '包含政策达标补贴（负数，降低成本）和不达标扣款（正数）。',
  },
  coverage: {
    id: 'coverage', label: '报价覆盖率',
    formula: '运费与报价一致的票数 ÷ 参与核对的票数',
    source: '逐单比对「应收（按报价计算）」与「实收（运费单价）」，容差 ±0.005 元',
  },
  diff: {
    id: 'diff', label: '差额',
    formula: 'Σ(实收运费 − 按报价应收)',
    source: '正数 = 多收客户，负数 = 少收客户',
  },
};
