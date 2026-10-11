// 省份标准化、大区归属与瓦片地图坐标。

export interface ProvinceInfo {
  name: string;
  region: string;
  /** 瓦片地图坐标（列, 行） */
  x: number;
  y: number;
}

export const PROVINCES: ProvinceInfo[] = [
  { name: '黑龙江', region: '东北', x: 8, y: 0 },
  { name: '内蒙古', region: '华北', x: 6, y: 1 },
  { name: '吉林', region: '东北', x: 8, y: 1 },
  { name: '新疆', region: '西北', x: 1, y: 2 },
  { name: '甘肃', region: '西北', x: 3, y: 2 },
  { name: '宁夏', region: '西北', x: 4, y: 2 },
  { name: '山西', region: '华北', x: 5, y: 2 },
  { name: '河北', region: '华北', x: 6, y: 2 },
  { name: '北京', region: '华北', x: 7, y: 2 },
  { name: '辽宁', region: '东北', x: 8, y: 2 },
  { name: '青海', region: '西北', x: 3, y: 3 },
  { name: '陕西', region: '西北', x: 4, y: 3 },
  { name: '河南', region: '华中', x: 5, y: 3 },
  { name: '山东', region: '华东', x: 6, y: 3 },
  { name: '天津', region: '华北', x: 7, y: 3 },
  { name: '西藏', region: '西南', x: 2, y: 4 },
  { name: '四川', region: '西南', x: 3, y: 4 },
  { name: '重庆', region: '西南', x: 4, y: 4 },
  { name: '湖北', region: '华中', x: 5, y: 4 },
  { name: '安徽', region: '华东', x: 6, y: 4 },
  { name: '江苏', region: '华东', x: 7, y: 4 },
  { name: '上海', region: '华东', x: 8, y: 4 },
  { name: '贵州', region: '西南', x: 4, y: 5 },
  { name: '湖南', region: '华中', x: 5, y: 5 },
  { name: '江西', region: '华东', x: 6, y: 5 },
  { name: '浙江', region: '华东', x: 7, y: 5 },
  { name: '云南', region: '西南', x: 3, y: 6 },
  { name: '广西', region: '华南', x: 4, y: 6 },
  { name: '广东', region: '华南', x: 5, y: 6 },
  { name: '福建', region: '华东', x: 6, y: 6 },
  { name: '台湾', region: '港澳台', x: 7, y: 6 },
  { name: '海南', region: '华南', x: 4, y: 7 },
  { name: '澳门', region: '港澳台', x: 5, y: 7 },
  { name: '香港', region: '港澳台', x: 6, y: 7 },
];

export const REGIONS = ['华东', '华北', '华中', '华南', '西南', '西北', '东北', '港澳台', '其他'];

const BY_NAME = new Map(PROVINCES.map((p) => [p.name, p]));

const SUFFIX = /(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/;

/** 把「浙江省」「广西壮族自治区」「上海市」等统一成简称；不认识的原样返回。 */
export function normalizeProvince(raw: string): string {
  const s = raw.trim();
  if (!s) return '未知';
  if (BY_NAME.has(s)) return s;
  const stripped = s.replace(SUFFIX, '');
  if (BY_NAME.has(stripped)) return stripped;
  // 「浙江省杭州市」这类：取前缀匹配
  for (const p of PROVINCES) if (s.startsWith(p.name)) return p.name;
  return s;
}

export function provinceInfo(name: string): ProvinceInfo | undefined {
  return BY_NAME.get(name);
}

export function regionOf(name: string): string {
  return BY_NAME.get(name)?.region ?? '其他';
}

/** 省份排序：先按大区，再按瓦片位置，保证图表顺序稳定、地理相近的挨在一起。 */
export function provinceOrder(name: string): number {
  const p = BY_NAME.get(name);
  if (!p) return 10_000;
  return REGIONS.indexOf(p.region) * 100 + p.y * 10 + p.x;
}
