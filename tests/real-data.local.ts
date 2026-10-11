// 本地真实数据冒烟脚本（数据不入库）：npx vite-node tests/real-data.local.ts local-data/chen.xlsx
import { readFileSync } from 'node:fs';
import { probeFile, loadFiles } from '../src/engine/load';
import { buildModel, applyFilters, DEFAULT_FILTERS } from '../src/engine/model';
import { inferQuote } from '../src/engine/quote/infer';
import { describeTail } from '../src/engine/quote/types';

const path = process.argv[2];
const buf = readFileSync(path);
const blob = new Blob([buf]);
let t = performance.now();
const probe = await probeFile(blob, path);
console.log('probe', probe.format, 'headerRow', probe.headerRow, Object.keys(probe.mapping).length, 'fields', (performance.now() - t).toFixed(0), 'ms');
t = performance.now();
const data = await loadFiles([{ file: blob, probe }]);
console.log('rows', data.n, 'load', (performance.now() - t).toFixed(0), 'ms');
t = performance.now();
const m = buildModel(data);
const { mask } = applyFilters(m, DEFAULT_FILTERS);
console.log('model', (performance.now() - t).toFixed(0), 'ms', m.provNames.length, 'provinces', m.priceBasis);
t = performance.now();
const r = inferQuote(m, mask);
console.log('infer', (performance.now() - t).toFixed(0), 'ms coverage', (r.coverage * 100).toFixed(2) + '%', 'bps', r.quote.breakpoints, 'sheetFee', r.quote.sheetFee);
for (const z of r.quote.zones) {
  console.log(z.name, z.prices.join(' | '), z.tail ? describeTail(z.tail) + ` (${z.tail.rounding})` : '-', `${z.stats!.matched}/${z.stats!.tickets}`, z.stats!.tailLowConfidence ? '低置信' : '', z.provinces.join('、'));
}
r.notes.forEach((n) => console.log('note:', n));

import { detectPricePeriods, periodMask } from '../src/engine/quote/periods';
const periods = detectPricePeriods(m, mask);
console.log('periods', periods.map((p) => `${p.label} ${p.tickets}票 ${JSON.stringify(p.signature)}`));
if (periods.length > 1) for (const p of periods) {
  const r2 = inferQuote(m, periodMask(m, mask, p));
  console.log(`\n== ${p.label} coverage ${(r2.coverage * 100).toFixed(2)}% bps ${r2.quote.breakpoints} sheetFee ${r2.quote.sheetFee}`);
  for (const z of r2.quote.zones) console.log(z.name, z.prices.join(' | '), z.tail ? describeTail(z.tail) : '-', `${z.stats!.matched}/${z.stats!.tickets}`, z.stats!.tailLowConfidence ? '低置信' : '', z.provinces.join('、'));
  r2.notes.forEach((n) => console.log('note:', n));
}
