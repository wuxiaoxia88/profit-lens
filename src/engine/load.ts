// 文件加载编排：探测表头 → 自动识别字段 → 流式写入数据集。
// 在 Web Worker 中运行，也可在 Node（单元测试）中直接调用。
import { DatasetBuilder, ProbeSink } from './builder';
import type { DatasetData } from './dataset';
import { streamCsv } from './parse/csv';
import { streamXlsx, type CellSink } from './parse/xlsx';
import { isZip } from './parse/zip';
import { autoMap, looksLikeHeader, type ColumnMapping } from './schema';

export interface ProbeResult {
  fileName: string;
  format: 'xlsx' | 'csv';
  headerRow: number;
  headers: string[];
  sample: string[][];
  mapping: ColumnMapping;
}

async function formatOf(file: Blob, name: string): Promise<'xlsx' | 'csv'> {
  if (await isZip(file)) return 'xlsx';
  if (/\.xls$/i.test(name)) throw new Error(`「${name}」是旧版 .xls 格式，请在 Excel 中另存为 .xlsx 或 .csv 后再导入`);
  return 'csv';
}

async function stream(file: Blob, format: 'xlsx' | 'csv', sink: CellSink, onProgress?: (f: number) => void) {
  if (format === 'xlsx') await streamXlsx(file, sink, { onProgress });
  else await streamCsv(file, sink, onProgress);
}

export async function probeFile(file: Blob, fileName: string): Promise<ProbeResult> {
  const format = await formatOf(file, fileName);
  const probe = new ProbeSink(40);
  await stream(file, format, probe);
  const headerRow = Math.max(0, probe.rows.findIndex((r) => looksLikeHeader(r)));
  const headers = (probe.rows[headerRow] ?? []).map((h) => String(h ?? '').trim());
  return {
    fileName,
    format,
    headerRow,
    headers,
    sample: probe.rows.slice(headerRow + 1, headerRow + 6),
    mapping: autoMap(headers),
  };
}

export interface LoadJob {
  file: Blob;
  probe: ProbeResult;
}

export async function loadFiles(jobs: LoadJob[], onProgress?: (fileIndex: number, fraction: number, rows: number) => void): Promise<DatasetData> {
  const builder = new DatasetBuilder();
  for (let k = 0; k < jobs.length; k++) {
    const { file, probe } = jobs[k];
    builder.beginFile({ mapping: probe.mapping, headerRow: probe.headerRow, source: { fileName: probe.fileName, rows: 0, format: probe.format } });
    let lastReport = 0;
    await stream(file, probe.format, builder, (f) => {
      const now = Date.now();
      if (now - lastReport > 120) { lastReport = now; onProgress?.(k, f, builder.n); }
    });
    builder.endFile();
    onProgress?.(k, 1, builder.n);
  }
  return builder.finish();
}

/** 读取小表格（如上传的报价单）为字符串二维数组 */
export async function readTable(file: Blob, fileName: string, limit = 5000): Promise<string[][]> {
  const format = await formatOf(file, fileName);
  const sink = new ProbeSink(limit);
  await stream(file, format, sink);
  return sink.rows;
}
