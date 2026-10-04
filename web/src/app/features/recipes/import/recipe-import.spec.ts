import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RecipeImport } from './recipe-import';

describe('RecipeImport', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RecipeImport],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  it('previews pasted recipes and saves only the selected ones, one at a time', async () => {
    const fixture = TestBed.createComponent(RecipeImport);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const box = el.querySelector<HTMLTextAreaElement>('[data-testid="import-text"]')!;
    box.value = 'Soup\nIngredients\n- 1 onion\nDirections\n1. Chop\n---\nToast\nIngredients\nBread';
    button(el, 'Preview').click();
    await fixture.whenStable();

    expect(el.textContent).toContain('Found 2 recipes');
    const checks = el.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    checks[1].checked = false;
    checks[1].dispatchEvent(new Event('change'));
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
