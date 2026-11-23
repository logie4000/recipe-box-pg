import { buildShoppingListPdf, pdfFileName, pdfSafe } from './shopping-list-pdf';
import { servingsLabel } from './shopping-list-page';
import { ShoppingListItem } from './shopping-list.api';

const item = (name: string, text: string, title = 'Pancakes'): ShoppingListItem => ({
  key: name,
  name,
  amounts: text ? [{ quantity: 1, unit: '', text }] : [],
  sources: [{ public_id: 'Pancakes0001', title, line: `${text} ${name}` }],
});

/** The PDF's text runs (uncompressed by default in jsPDF). */
function pdfText(raw: string): string {
  return [...raw.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join('\n');
}

describe('buildShoppingListPdf', () => {
  it('lists the recipes and the items with tick boxes', async () => {
    const doc = await buildShoppingListPdf({
      recipes: [{ public_id: 'Pancakes0001', title: 'Pancakes', servings: 1.5, mine: true }],
      items: [item('flour', '3 1/2 cups + 100 g'), item('salt', '', 'Bread')],
      servingsLabel,
      date: new Date(2026, 10, 22),
    });
    const raw = doc.output();
    expect(raw.startsWith('%PDF-')).toBe(true);
    const text = pdfText(raw);
    expect(text).toContain('Shopping list');
    expect(text).toContain('Pancakes  \\(1\u00bd\u00d7\\)');
    expect(text).toContain('flour - 3 1/2 cups + 100 g');
    expect(text).toContain('salt');
    expect(text).toContain('for Bread');
    expect(raw).toContain(' re'); // the tick boxes
  });

  it('runs onto more pages for a long list', async () => {
    const items = Array.from({ length: 80 }, (_, i) => item(`thing ${i}`, '1 cup'));
    const doc = await buildShoppingListPdf({ recipes: [], items, servingsLabel });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('says so when everything is ticked', async () => {
    const doc = await buildShoppingListPdf({ recipes: [], items: [], servingsLabel });
    expect(pdfText(doc.output())).toContain('Nothing left to get.');
  });

  it('names the file by date', () => {
    expect(pdfFileName(new Date(2026, 0, 5))).toBe('shopping-list-2026-01-05.pdf');
  });

  it('keeps text to what the built-in font can draw', () => {
    expect(pdfSafe('Crème brûlée – ½ cup “fresh” ⅓ tsp…')).toBe(
      'Crème brûlée - ½ cup "fresh" 1/3 tsp...',
    );
    expect(pdfSafe('Łódź 🍋 salt')).toBe('ódz  salt');
  });
});
