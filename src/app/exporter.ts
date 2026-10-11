// 导出：单卡片高清 PNG、整页/整份报告 PDF、xlsx 文件下载。
import { domToCanvas, domToPng } from 'modern-screenshot';

const SCALE = 3;
/** PDF 用 2 倍（约 220dpi），文件更小且打印清晰 */
const PDF_SCALE = 2;

function pageBg(): string {
  return getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#ffffff';
}

const filter = (node: Node) => !(node instanceof HTMLElement && node.classList.contains('no-export'));

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function exportNodePng(node: HTMLElement, name: string) {
  const url = await domToPng(node, { scale: SCALE, backgroundColor: pageBg(), filter });
  const blob = await (await fetch(url)).blob();
  downloadBlob(blob, `${safeName(name)}-${stamp()}.png`);
}

export interface PdfMeta {
  title: string;
  lines: string[];
  footer: string;
}

/**
 * 把若干组卡片排进 A4 横版 PDF：每组（一个页签）从新页开始，卡片按宽度缩放、放不下就换页。
 * 卡片按两列网格排布时，相邻两张同行的卡片并排放置。
 */
export async function exportPdf(groups: { title: string; prepare: () => Promise<HTMLElement[]> }[], meta: PdfMeta, onStep?: (i: number, n: number) => void) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210, M = 10, GAP = 4;
  const contentW = W - 2 * M;
  const bg = pageBg();
  let y = M;
  let page = 1;

  // 封面信息（用图片方式绘制中文，jsPDF 内置字体不含中文）
  const cover = document.createElement('div');
  cover.className = 'pdf-cover';
  cover.innerHTML = `<h1>${escapeHtml(meta.title)}</h1>${meta.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}`;
  document.body.appendChild(cover);
  const coverCanvas = await domToCanvas(cover, { scale: PDF_SCALE, backgroundColor: bg });
  cover.remove();
  const ch = (coverCanvas.height / coverCanvas.width) * contentW;
  pdf.addImage(coverCanvas, 'PNG', M, y, contentW, ch, undefined, 'FAST');
  y += ch + GAP;

  const footerCanvas = await textCanvas(meta.footer, bg);
  const drawFooter = () => {
    const fw = contentW, fh = (footerCanvas.height / footerCanvas.width) * fw;
    pdf.addImage(footerCanvas, 'PNG', M, H - M + 2 - fh, fw, fh, undefined, 'FAST');
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(String(page), W - M, H - 4, { align: 'right' });
  };
  const footerH = 6;
  const bottom = H - M - footerH;

  let total = 0;
  let done = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = { title: groups[gi].title, nodes: await groups[gi].prepare() };
    total += g.nodes.length;
    if (gi > 0) { drawFooter(); pdf.addPage(); page++; y = M; }
    // 按 offsetTop 分行：同一行的卡片并排
    const rows: HTMLElement[][] = [];
    for (const n of g.nodes) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].offsetTop - n.offsetTop) < 4) last.push(n);
      else rows.push([n]);
    }
    for (const row of rows) {
      const canvases = [];
      for (const n of row) {
        canvases.push(await domToCanvas(n, { scale: PDF_SCALE, backgroundColor: bg, filter }));
        onStep?.(++done, total);
      }
      const totalPx = row.reduce((a, n) => a + n.offsetWidth, 0);
      const usable = contentW - GAP * (row.length - 1);
      const widths = row.map((n) => (n.offsetWidth / totalPx) * usable);
      let heights = canvases.map((c, i) => (c.height / c.width) * widths[i]);
      let scale = 1;
      const maxH = Math.max(...heights);
      const pageCap = bottom - M;
      if (maxH > pageCap) scale = pageCap / maxH;
      heights = heights.map((h) => h * scale);
      const rowH = Math.max(...heights);
      if (y + rowH > bottom && y > M + 1) { drawFooter(); pdf.addPage(); page++; y = M; }
      let x = M;
      canvases.forEach((c, i) => {
        const w = widths[i] * scale;
        pdf.addImage(c, 'PNG', x, y, w, heights[i], undefined, 'FAST');
        x += widths[i] + GAP;
      });
      y += rowH + GAP;
    }
  }
  drawFooter();
  downloadBlob(pdf.output('blob'), `${safeName(meta.title)}-${stamp()}.pdf`);
}

async function textCanvas(text: string, bg: string): Promise<HTMLCanvasElement> {
  const el = document.createElement('div');
  el.className = 'pdf-footer';
  el.textContent = text;
  document.body.appendChild(el);
  const c = await domToCanvas(el, { scale: PDF_SCALE, backgroundColor: bg });
  el.remove();
  return c;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function downloadXlsx(bytes: Uint8Array<ArrayBuffer>, name: string) {
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(name)}-${stamp()}.xlsx`);
}
