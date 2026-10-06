import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth.service';
import { RecipeImport } from './recipe-import';

describe('RecipeImport', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RecipeImport],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { displayName: computed(() => 'Eddie Editor') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  /** The preview asks for the recipes already in the box, and the Saved ones. */
  const existing = (items: object[], saved: object[] = []) => {
    backend
      .expectOne((r) => r.url === '/api/v1/recipes' && r.method === 'GET')
      .flush({ items, total: items.length, limit: 100, offset: 0 });
    backend.expectOne('/api/v1/saved-recipes').flush({ items: saved });
  };

  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  const picks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>('.pick'));

  async function paste(text: string, mine: object[] = []) {
    const fixture = TestBed.createComponent(RecipeImport);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLTextAreaElement>('[data-testid="import-text"]')!.value = text;
    button(el, 'Preview').click();
    existing(mine);
    await fixture.whenStable();
    return { fixture, el };
  }

  it('lists each recipe as a collapsed section and saves only the ticked ones', async () => {
    const { fixture, el } = await paste(
      'Soup\nIngredients\n- 1 onion\nDirections\n1. Chop\n---\nToast\nIngredients\nBread',
    );

    expect(el.textContent).toContain('Found 2 recipes');
    expect(el.querySelectorAll('.twistie').length).toBe(2);
    expect(el.querySelector('app-import-recipe-editor')).toBeNull();

    picks(el)[1].click();
    await fixture.whenStable();

    button(el, 'Import 1 recipe').click();
    const req = backend.expectOne('/api/v1/recipes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      recipe: { title: 'Soup', ingredients: ['1 onion'], directions: ['Chop'], notes: '' },
    });
    req.flush({ id: 5, recipe: {} });
    await fixture.whenStable();

    expect(el.textContent).toContain('Imported 1 of 1');
    expect(el.querySelector('a[href="/recipes/5"]')?.textContent).toContain('Saved');
  });

  it('waits out a 429 and retries, instead of failing the rest of the import', async () => {
    const { fixture, el } = await paste('Soup\nIngredients\nOnion');
    const waits: number[] = [];
    (fixture.componentInstance as unknown as { sleep: (ms: number) => Promise<void> }).sleep = (
      ms,
    ) => {
      waits.push(ms);
      return Promise.resolve();
    };

    button(el, 'Import 1 recipe').click();
    backend
      .expectOne('/api/v1/recipes')
      .flush(
        { error: 'rate_limited' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '7' } },
      );
    await fixture.whenStable();
    backend.expectOne('/api/v1/recipes').flush({ id: 9, recipe: {} });
    // Let the save loop's promise chain finish.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(waits).toEqual([7000]);
    expect(el.textContent).toContain('Imported 1 of 1');
  });

  it('opens a single recipe on its preview, and saves what was edited', async () => {
    const { fixture, el } = await paste('Soup\nIngredients\nOnion\nDirections\nChop');

    // Preview: laid out like the recipe page, with the importer as author.
    const preview = el.querySelector('[data-testid="preview"]')!;
    expect(preview.querySelector('h1')?.textContent).toContain('Soup');
    expect(preview.textContent).toContain('by Eddie Editor');
    expect(preview.querySelectorAll('ol li').length).toBe(1);

    // Edit: change the title and add a step (blank lines are dropped).
    button(el, 'Edit').click();
    await fixture.whenStable();
    const title = el.querySelector<HTMLInputElement>('[data-testid="edit-title"]')!;
    title.value = 'Onion soup';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const steps = el.querySelector<HTMLTextAreaElement>('[data-testid="edit-directions"]')!;
    steps.value = 'Chop\n\nSimmer';
    steps.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    button(el, 'Preview').click();
    await fixture.whenStable();
    const updated = el.querySelector('[data-testid="preview"]')!;
    expect(updated.querySelector('h1')?.textContent).toContain('Onion soup');
    expect(updated.querySelectorAll('ol li').length).toBe(2);
    expect(el.querySelector('.twistie-title')?.textContent).toContain('Onion soup');

    button(el, 'Import 1 recipe').click();
    const req = backend.expectOne('/api/v1/recipes');
    expect(req.request.body.recipe).toEqual({
      title: 'Onion soup',
      ingredients: ['Onion'],
      directions: ['Chop', 'Simmer'],
      notes: '',
    });
    req.flush({ id: 6, recipe: {} });
    await fixture.whenStable();
  });

  it("won't import a ticked recipe whose title was cleared", async () => {
    const { fixture, el } = await paste('Soup\nIngredients\nOnion');
    button(el, 'Edit').click();
    await fixture.whenStable();
    const title = el.querySelector<HTMLInputElement>('[data-testid="edit-title"]')!;
    title.value = '  ';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(button(el, 'Import 1 recipe').disabled).toBe(true);
    expect(el.textContent).toContain('Every ticked recipe needs a title');
  });

  it('unticks recipes already in the box and repeats in the file', async () => {
    const { el } = await paste(
      [
        'Soup',
        'Ingredients',
        'Onion',
        '---',
        'Toast',
        'Ingredients',
        'Bread',
        '---',
        'toast',
        'Ingredients',
        'bread',
      ].join('\n'),
      [{ id: 1, title: 'Soup', ingredients: ['Onion'], directions: [], notes: '' }],
    );

    expect(picks(el).map((c) => c.checked)).toEqual([false, true, false]);
    expect(el.textContent).toContain('Already in your box');
    expect(el.textContent).toContain('Repeated in this file');
    expect(el.textContent).toContain('2 you already have are unticked');
    expect(button(el, 'Import 1 recipe')).toBeTruthy();
  });

  it('shows the reason when input has no recipes', async () => {
    const fixture = TestBed.createComponent(RecipeImport);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLTextAreaElement>('[data-testid="import-text"]')!.value = '{"a": 1}';
    button(el, 'Preview').click();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No recipes');
  });
});
