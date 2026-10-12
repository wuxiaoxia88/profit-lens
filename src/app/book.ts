// 多客户报价核对：有价格表的客户用价格表，没有的用系统实际收费还原的报价；
// 「以系统为准」的省份（默认北京）偏离报价不计差异。
import { useMemo } from 'react';
import { readWorkbook } from '../engine/load';
import { inferPerCustomer } from '../engine/quote/compose';
import { checkCustomers, type CustomerCheck, type CustomerQuote, type MultiCheckResult } from '../engine/quote/multi';
import type { Quote } from '../engine/quote/types';
import { matchSheetsToCustomers, parseQuoteWorkbook, type ParsedSheet } from '../engine/quote/workbook';
import type { Model } from '../engine/model';
import { useDerived, useStore, type QuoteBook } from './store';

export async function loadQuoteBook(file: File, m: Model): Promise<QuoteBook> {
  const sheets = parseQuoteWorkbook(await readWorkbook(file, file.name));
  const usable = sheets.filter((s) => s.quote);
  if (!usable.length) throw new Error('没有在文件中识别到报价表。需要「省份/城市 + 重量段」表头，详见使用手册。');
  const cust = m.data.dict.customer;
  const present = new Set<string>();
  if (cust) for (let i = 0; i < m.n; i++) present.add(cust.values[cust.codes[i]]);
  const { assign, weak } = matchSheetsToCustomers(usable.map((s) => s.sheet), [...present].filter(Boolean));
  return { fileName: file.name, sheets, assign, weak };
}

export function sheetOf(book: QuoteBook | null, customer: string): ParsedSheet | undefined {
  const name = book?.assign[customer];
  return name ? book!.sheets.find((s) => s.sheet === name && s.quote) : undefined;
}

export interface CustomerCheckBundle extends MultiCheckResult {
  byCode: Map<number, CustomerCheck>;
  /** 系统还原的各客户报价（没有价格表的客户用它核对，也用于导出补全价格表） */
  inferred: Map<number, Quote>;
}

export function useCustomerCheck(): CustomerCheckBundle | null {
  const d = useDerived();
  const { s } = useStore();
  const book = s.quoteBook;
  const sysProv = s.systemProvinces;
  const inferred = useMemo(() => {
    const cust = d?.model.data.dict.customer;
    if (!d || !cust || !d.model.caps.quote) return null;
    const seen = new Uint8Array(cust.values.length);
    for (let i = 0; i < d.model.n; i++) if (d.mask[i]) seen[cust.codes[i]] = 1;
    const codes = cust.values.map((_, c) => c).filter((c) => seen[c] && cust.values[c]);
    return inferPerCustomer(d.model, d.mask, codes);
  }, [d]);
  return useMemo(() => {
    if (!d || !inferred || !d.model.data.dict.customer) return null;
    const cust = d.model.data.dict.customer;
    const assign = new Map<number, CustomerQuote>();
    cust.values.forEach((name, code) => {
      const sh = sheetOf(book, name);
      if (sh?.quote) assign.set(code, { sheet: sh.sheet, quote: sh.quote, effectiveFrom: sh.effectiveFrom, source: 'sheet' });
      else if (inferred.has(code)) assign.set(code, { sheet: '系统还原', quote: inferred.get(code)!, source: 'system' });
    });
    const r = checkCustomers(d.model, d.mask, assign, sysProv);
    return { ...r, byCode: new Map(r.byCustomer.map((c) => [c.code, c])), inferred };
  }, [d, book, inferred, sysProv]);
}
