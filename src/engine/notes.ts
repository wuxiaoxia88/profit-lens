// 特殊区域备注：某些省份里个别城市/海岛成本异常（派费高、需转运等）。
// 只作为提示显示在流向、报价相关的位置，不改变整个省份的价格与统计。

export type ProvinceNotes = Record<string, string>;

export const DEFAULT_PROVINCE_NOTES: ProvinceNotes = {
  天津: '天津部分区域成本偏高，报价时留意',
  广东: '深圳、广州成本偏高（派费、中转），省内其他城市正常',
  浙江: '舟山等海岛件成本偏高（需转运），省内其他城市正常',
};

export function noteOf(notes: ProvinceNotes, province: string): string | undefined {
  const v = notes[province];
  return v && v.trim() ? v.trim() : undefined;
}

/** 解析编辑框文本：每行「省份：备注」 */
export function parseNotesText(text: string): ProvinceNotes {
  const out: ProvinceNotes = {};
  for (const line of text.split(/\n+/)) {
    const m = /^\s*([^：:]+?)\s*[：:]\s*(.+)$/.exec(line);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export function notesToText(notes: ProvinceNotes): string {
  return Object.entries(notes).map(([k, v]) => `${k}：${v}`).join('\n');
}
