// 多客户报价工作簿：上传解析、自动匹配结算对象、按筛选范围一次核对所有客户。
import { useMemo } from 'react';
import { readWorkbook } from '../engine/load';
import { checkCustomers, type CustomerCheck, type CustomerQuote, type MultiCheckResult } from '../engine/quote/multi';
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

export interface BookCheck extends MultiCheckResult {
  byCode: Map<number, CustomerCheck>;
}

export function useBookCheck(): BookCheck | null {
  const d = useDerived();
  const { s } = useStore();
  const book = s.quoteBook;
  return useMemo(() => {
    if (!d || !book || !d.model.data.dict.customer) return null;
    const cust = d.model.data.dict.customer;
    const assign = new Map<number, CustomerQuote>();
    cust.values.forEach((name, code) => {
      const sh = sheetOf(book, name);
      if (sh?.quote) assign.set(code, { sheet: sh.sheet, quote: sh.quote, effectiveFrom: sh.effectiveFrom });
    });
    const r = checkCustomers(d.model, d.mask, assign);
    return { ...r, byCode: new Map(r.byCustomer.map((c) => [c.code, c])) };
  }, [d, book]);
}
