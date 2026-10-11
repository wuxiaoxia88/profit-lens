// 设计令牌：与 styles.css 中的 CSS 变量一一对应；图表从这里取色。
// 分类色、顺序色、发散色取自经校验的参考色板（色盲安全）。
export interface Theme {
  dark: boolean;
  surface: string;
  page: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
  seq: string[]; // 浅 → 深（蓝）
  div: { neg: string[]; mid: string; pos: string[] }; // 亏损（红）← 灰 → 盈利（蓝）
  good: string;
  critical: string;
}

export const LIGHT: Theme = {
  dark: false,
  surface: '#ffffff',
  page: '#f6f6f3',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  seq: ['#e8f1fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  div: { neg: ['#9e2a2a', '#d03b3b', '#ec8b87', '#f6c9c6'], mid: '#f0efec', pos: ['#cde2fb', '#86b6ef', '#2a78d6', '#184f95'] },
  good: '#006300',
  critical: '#d03b3b',
};

export const DARK: Theme = {
  dark: true,
  surface: '#1a1a19',
  page: '#0d0d0d',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  seq: ['#1f2a3a', '#104281', '#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
  div: { neg: ['#f19a97', '#e66767', '#b13c3c', '#5a2828'], mid: '#383835', pos: ['#1d3557', '#1c5cab', '#3987e5', '#86b6ef'] },
  good: '#0ca30c',
  critical: '#e66767',
};

/** 发散色：亏损 → 0 → 盈利 */
export function divergingColors(t: Theme): string[] {
  return [...t.div.neg, t.div.mid, ...t.div.pos];
}

export const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';
