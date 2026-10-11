// 合成示例数据：结构与盈亏分析系统导出一致，数值为虚构（仅用于演示和测试，不含任何真实客户信息）。
import type { DatasetData } from './dataset';
import type { NumField } from './schema';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 省份：[票量权重, 1kg 内中转成本, 派费, 中转成本每 kg 增量, 派费每 kg 增量]
const PROV: Record<string, [number, number, number, number, number]> = {
  河南: [88, 0.6, 1.4, 0.25, 0.33], 广东: [80, 0.55, 1.45, 0.5, 0.2], 山东: [70, 0.5, 1.4, 0.22, 0.3], 江苏: [68, 0.45, 1.4, 0.2, 0.28],
  安徽: [65, 0.5, 1.35, 0.18, 0.25], 浙江: [58, 0.38, 1.4, 0.25, 0.2], 湖南: [57, 0.62, 1.42, 0.22, 0.32], 江西: [55, 0.45, 1.45, 0.15, 0.3],
  湖北: [55, 0.6, 1.42, 0.2, 0.3], 陕西: [54, 0.85, 1.55, 0.45, 0.36], 四川: [48, 1.0, 1.55, 0.42, 0.32], 河北: [45, 0.7, 1.42, 0.3, 0.35],
  广西: [33, 0.78, 1.46, 0.25, 0.25], 福建: [30, 0.38, 1.38, 0.18, 0.25], 贵州: [26, 1.15, 1.62, 0.55, 0.4], 重庆: [24, 0.95, 1.48, 0.32, 0.27],
  云南: [20, 0.75, 1.58, 0.35, 0.42], 辽宁: [20, 1.05, 1.52, 0.6, 0.42], 山西: [19, 0.8, 1.52, 0.48, 0.38], 上海: [15, 0.35, 2.1, 0.15, 0.36],
  黑龙江: [12, 1.45, 1.68, 0.85, 0.6], 吉林: [11, 1.42, 1.55, 0.72, 0.48], 天津: [10, 0.58, 1.62, 0.28, 0.32], 北京: [10, 0.62, 2.05, 0.42, 0.5],
  甘肃: [8, 1.85, 1.82, 1.4, 0.7], 内蒙古: [6, 1.55, 1.9, 1.3, 0.8], 海南: [3, 1.55, 1.75, 1.1, 0.4], 宁夏: [3, 1.6, 1.72, 1.1, 0.55],
  青海: [2, 2.3, 2.3, 1.4, 0.45], 新疆: [0.7, 2.6, 3.6, 3.8, 0.7], 西藏: [0.6, 7, 4.6, 5.5, 0.65],
};

const JINGHU = new Set(['北京', '上海']);
const REMOTE = new Set(['甘肃', '内蒙古', '海南', '宁夏', '青海']);
const XINZANG = new Set(['新疆', '西藏']);
const JZH = new Set(['江苏', '浙江', '上海', '安徽']);

/** 示例报价：面单费 2.3 + 中转加价 */
export function demoPrice(prov: string, w: number): number {
  if (XINZANG.has(prov)) return w <= 1 ? 16 : Math.round((16 + 15 * (w - 1)) * 100) / 100;
  const table = JINGHU.has(prov) ? [3.3, 3.9, 4.7, 5.7] : REMOTE.has(prov) ? [4.3, 4.9, 7.7, 9.7] : [2.3, 2.9, 3.7, 4.7];
  const bps = [1.2, 1.5, 2, 3];
  for (let i = 0; i < bps.length; i++) if (w <= bps[i] + 1e-9) return table[i];
  const perKg = JZH.has(prov) ? 1 : REMOTE.has(prov) ? 4 : 2;
  return table[3] + 1.4 + perKg * Math.ceil(w - 3 - 1e-9);
}

function sampleWeight(r: () => number): number {
  const u = r();
  let w: number;
  if (u < 0.07) w = 0.1;
  else if (u < 0.93) w = 0.45 + r() * 0.65 + (r() < 0.5 ? r() * 0.1 : 0);
  else if (u < 0.985) w = 1.1 + r() * 1.1;
  else if (u < 0.997) w = 2.1 + r() * 2;
  else w = 4 + r() * 16;
  return Math.round(w * 100) / 100;
}

export function generateDemo(n = 60000, seed = 20261011): DatasetData {
  const r = rng(seed);
  const provNames = Object.keys(PROV);
  const cum: number[] = [];
  let acc = 0;
  for (const p of provNames) { acc += PROV[p][0]; cum.push(acc); }
  const pickProv = () => { const x = r() * acc; let i = 0; while (cum[i] < x) i++; return i; };

  const accounts = ['PDD_示例旗舰店', 'TB_示例专营店', 'DY_示例小店', 'KS_示例好物', 'JD_示例自营'];
  const accountNames = ['示例鞋服旗舰店', '示例鞋服专营店', '示例抖音小店', '示例快手好物', '示例京东店'];
  const accWeights = [0.55, 0.3, 0.08, 0.05, 0.02];
  const signValues = ['已签收', '待签收', '未签收'];
  const yesNo = ['否', '是'];
  const shippedValues = ['已发货', '未发货'];

  const num: Record<NumField, Float64Array> = {
    weight: new Float64Array(n), profit: new Float64Array(n), income: new Float64Array(n), cost: new Float64Array(n),
    inTransfer: new Float64Array(n), inSheet: new Float64Array(n), inVA: new Float64Array(n),
    cTransfer: new Float64Array(n), cDispatch: new Float64Array(n), cSheet: new Float64Array(n), cVA: new Float64Array(n), cPolicy: new Float64Array(n),
  };
  const codes = {
    dest: new Int32Array(n), account: new Int32Array(n), accountName: new Int32Array(n), signStatus: new Int32Array(n),
    returned: new Int32Array(n), selfSign: new Int32Array(n), shipped: new Int32Array(n), customer: new Int32Array(n),
    customerType: new Int32Array(n), bizType: new Int32Array(n), customerCode: new Int32Array(n),
  };
  const date = new Int32Array(n);
  const signDate = new Int32Array(n);
  const day0 = Math.floor(Date.UTC(2026, 8, 1) / 86400000);
  const wbParts: string[] = [];
  const r2 = (v: number) => Math.round(v * 1000) / 1000;

  for (let i = 0; i < n; i++) {
    const pi = pickProv();
    const prov = provNames[pi];
    const [, zz1, pf1, zzk, pfk] = PROV[prov];
    const w = sampleWeight(r);
    let a = 0; const ua = r(); let ca = 0; while (a < accWeights.length - 1 && ua > (ca += accWeights[a])) a++;
    const d = day0 + Math.floor(r() * 30);
    const returned = r() < 0.025 ? 1 : 0;
    const selfSign = r() < 0.005 ? 1 : 0;
    const shipped = r() < 0.0005 ? 1 : 0;
    const su = r();
    const sign = su < 0.93 ? 0 : su < 0.985 ? 1 : 2;

    let price = demoPrice(prov, w);
    // 少量异常单，供「报价核对」演示
    if (r() < 0.0004) price += r() < 0.5 ? 1 : -0.5;
    const sheet = 2.3;
    const va = returned ? r2(0.5 + r() * 1) : 0;
    const extraW = Math.max(0, w - 1);
    const cT = r2(Math.max(0, zz1 * (0.85 + r() * 0.3) + zzk * extraW + (w < 0.5 ? -0.1 : 0)));
    const cD = r2(pf1 * (0.92 + r() * 0.16) + pfk * extraW);
    const cS = 1.05;
    const pol = sign === 2 ? 0 : r() < 0.85 ? -1.107 : -(1.6 + r() * 0.1);
    const income = r2(price + va);
    const cost = r2(cT + cD + cS + va + pol);

    num.weight[i] = w;
    num.inSheet[i] = sheet; num.inTransfer[i] = r2(price - sheet); num.inVA[i] = va;
    num.cTransfer[i] = cT; num.cDispatch[i] = cD; num.cSheet[i] = cS; num.cVA[i] = va; num.cPolicy[i] = r2(pol);
    num.income[i] = income; num.cost[i] = cost; num.profit[i] = r2(income - cost);
    codes.dest[i] = pi; codes.account[i] = a; codes.accountName[i] = a; codes.signStatus[i] = sign;
    codes.returned[i] = returned; codes.selfSign[i] = selfSign; codes.shipped[i] = shipped;
    date[i] = d;
    signDate[i] = sign === 0 ? d + 2 + Math.floor(r() * 3) : -2147483648;
    wbParts.push('7900' + String(10000000000 + i * 7919 + Math.floor(r() * 7000)).slice(-10));
  }
  const enc = new TextEncoder();
  const bytes = enc.encode(wbParts.join(''));
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + wbParts[i].length;

  return {
    n,
    fields: ['date', 'waybill', 'customerType', 'customer', 'customerCode', 'accountName', 'account', 'bizType', 'dest', 'weight', 'signDate', 'signStatus', 'returned', 'selfSign', 'shipped',
      'profit', 'income', 'cost', 'inTransfer', 'inSheet', 'inVA', 'cTransfer', 'cDispatch', 'cSheet', 'cVA', 'cPolicy'],
    num,
    dict: {
      dest: { codes: codes.dest, values: provNames },
      account: { codes: codes.account, values: accounts },
      accountName: { codes: codes.accountName, values: accountNames },
      signStatus: { codes: codes.signStatus, values: signValues },
      returned: { codes: codes.returned, values: yesNo },
      selfSign: { codes: codes.selfSign, values: yesNo },
      shipped: { codes: codes.shipped, values: shippedValues },
      customer: { codes: codes.customer, values: ['示例客户K1'] },
      customerType: { codes: codes.customerType, values: ['直营客户'] },
      bizType: { codes: codes.bizType, values: ['本网点的件'] },
      customerCode: { codes: codes.customerCode, values: ['B00000000001'] },
    },
    dates: { date, signDate },
    waybill: { bytes, offsets },
    sources: [{ fileName: '示例数据（虚构）', rows: n, format: 'demo' }],
  };
}

