import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RecipeExport } from './recipe-export';
import { RecipeExportPage } from './recipe-export-page';

const recipe = (id: number, title: string) => ({
  id,
  public_id: `code${id}`.padEnd(12, 'x'),
  title,
  ingredients: ['x'],
  directions: [],
  notes: '',
  image_key: null,
  author_name: null,
  is_public: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

describe('RecipeExportPage', () => {
  let backend: HttpTestingController;
  const download = vi.fn();

  beforeEach(() => {
    download.mockReset();
    TestBed.configureTestingModule({
      imports: [RecipeExportPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: RecipeExport, useValue: { download } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('starts with everything ticked and exports only what stays ticked', async () => {
    const fixture = TestBed.createComponent(RecipeExportPage);
    await fixture.whenStable();
    backend
      .expectOne((r) => r.url === '/api/v1/recipes')
      .flush({
        items: [recipe(1, 'Soup'), recipe(2, 'Chili'), recipe(3, 'Toast')],
        total: 3,
        limit: 100,
        offset: 0,
      });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // Alphabetical: Chili, Soup, Toast. Untick Soup.
    const rows = el.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(Array.from(rows).map((c) => c.checked)).toEqual([true, true, true]);
    rows[1].click();
    await fixture.whenStable();

    // Filtering to "to" and clearing the shown ones leaves Chili alone.
    const filter = el.querySelector<HTMLInputElement>('[data-testid="export-filter"]')!;
    filter.value = 'to';
    filter.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.click();
    await fixture.whenStable();

    const exportButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Export 1 recipe'),
    )!;
    exportButton.click();
    expect(download).toHaveBeenCalledWith([expect.objectContaining({ title: 'Chili' })]);
  });
});
