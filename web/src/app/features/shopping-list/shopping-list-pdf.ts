import type { jsPDF } from 'jspdf';

import { ShoppingListItem, ShoppingListRecipe } from './shopping-list.api';

export interface PdfInput {
  recipes: ShoppingListRecipe[];
  /** Items still to get; ticked ones are left out, as with Copy list. */
  items: ShoppingListItem[];
  servingsLabel: (n: number) => string;
  date?: Date;
}

const PAGE_MARGIN = 54; // 0.75in, in points
const LINE = 18;
const BOX = 10;

/**
 * Builds the shopping list as a one-column PDF: title and date, the recipes
 * with their multipliers, then a tick box per item with its amounts and,
 * in small grey type, which recipes it is for. jsPDF is loaded only when
 * someone asks for a PDF, so the page itself stays small.
 */
export async function buildShoppingListPdf(input: PdfInput): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const width = doc.internal.pageSize.getWidth();
  const bottom = doc.internal.pageSize.getHeight() - PAGE_MARGIN;
  const textWidth = width - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  const ensureRoom = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  };

  doc.setFont('helvetica', 'bold').setFontSize(20);
  doc.text('Shopping list', PAGE_MARGIN, y + 14);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110);
  const date = (input.date ?? new Date()).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.text(pdfSafe(date), width - PAGE_MARGIN, y + 14, { align: 'right' });
  y += 40;

  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0);
  doc.text('Recipes', PAGE_MARGIN, y);
  y += LINE - 2;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60);
  for (const r of input.recipes) {
    const lines = doc.splitTextToSize(
      pdfSafe(`${r.title}  (${input.servingsLabel(r.servings)})`),
      textWidth - 12,
    ) as string[];
    ensureRoom(lines.length * 13);
    doc.text('•', PAGE_MARGIN, y);
    doc.text(lines, PAGE_MARGIN + 12, y);
    y += lines.length * 13;
  }
  y += 14;

  doc.setDrawColor(200).line(PAGE_MARGIN, y - 8, width - PAGE_MARGIN, y - 8);
  y += 10;

  if (!input.items.length) {
    doc.setFontSize(11).setTextColor(110);
    doc.text('Nothing left to get.', PAGE_MARGIN, y);
  }

  const labelX = PAGE_MARGIN + BOX + 10;
  for (const item of input.items) {
    const amounts = item.amounts.map((a) => a.text).join(' + ');
    const main = doc
      .setFont('helvetica', 'normal')
      .setFontSize(12)
      .splitTextToSize(
        pdfSafe(amounts ? `${item.name} - ${amounts}` : item.name),
        textWidth - BOX - 10,
      ) as string[];
    const from = [...new Set(item.sources.map((s) => s.title))].join(', ');
    const fromLines = doc
      .setFontSize(8.5)
      .splitTextToSize(pdfSafe(`for ${from}`), textWidth - BOX - 10) as string[];
    ensureRoom(main.length * 15 + fromLines.length * 11 + 8);

    doc
      .setDrawColor(90)
      .setLineWidth(0.8)
      .rect(PAGE_MARGIN, y - BOX + 1, BOX, BOX);
    doc.setFontSize(12).setTextColor(0).text(main, labelX, y);
    y += main.length * 15 - 3;
    doc.setFontSize(8.5).setTextColor(130).text(fromLines, labelX, y);
    y += fromLines.length * 11 + 8;
  }

  return doc;
}

/** "shopping-list-2026-11-22.pdf", in the viewer's own date. */
export function pdfFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `shopping-list-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

/**
 * jsPDF's built-in Helvetica only covers Latin-1 (WinAnsi), so anything
 * outside it would print as junk. Accents are kept where Latin-1 has them,
 * common typographic marks are swapped for plain ones, and the rest is
 * decomposed or dropped.
 */
export function pdfSafe(s: string): string {
  const swapped = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/⅓/g, '1/3')
    .replace(/⅔/g, '2/3')
    .replace(/⅛/g, '1/8');
  let out = '';
  for (const ch of swapped) {
    if (ch.charCodeAt(0) <= 0xff) {
      out += ch;
    } else {
      out += ch
        .normalize('NFKD')
        .split('')
        .filter((c) => c.charCodeAt(0) <= 0xff)
        .join('');
    }
  }
  return out;
}
