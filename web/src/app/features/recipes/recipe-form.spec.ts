import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { RecipeForm, splitLines } from './recipe-form';

describe('splitLines', () => {
  it('splits pasted lists into items, dropping blanks and list markers', () => {
    expect(splitLines('- 2 eggs\r\n\n* 1 cup milk\n3. a pinch of salt\n  butter  ')).toEqual([
      '2 eggs',
      '1 cup milk',
      'a pinch of salt',
      'butter',
    ]);
  });

  it('keeps numbers that are part of the item', () => {
    expect(splitLines('2 eggs\n350 g flour')).toEqual(['2 eggs', '350 g flour']);
  });
});

describe('RecipeForm', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RecipeForm],
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

  it('previews the recipe as it will look, keeping what was typed', async () => {
    const fixture = TestBed.createComponent(RecipeForm);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const tab = (name: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (b) => b.textContent?.trim() === name,
      )!;

    const title = el.querySelector<HTMLInputElement>('input[formcontrolname="title"]')!;
    title.value = 'Soup';
    title.dispatchEvent(new Event('input'));
    const step = el.querySelector<HTMLTextAreaElement>('#directions-0')!;
    step.value = 'Chop';
    step.dispatchEvent(new Event('input'));

    tab('Preview').click();
    await fixture.whenStable();
    const preview = el.querySelector('[data-testid="preview"]')!;
    expect(preview.querySelector('h1')?.textContent).toContain('Soup');
    expect(preview.textContent).toContain('by Eddie Editor');
    expect(preview.querySelectorAll('ol li').length).toBe(1);
    expect(title.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);

    tab('Edit').click();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="preview"]')).toBeNull();
    expect(title.value).toBe('Soup');
  });

  it('creates a recipe without blank rows, then opens it', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RecipeForm);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const set = (selector: string, value: string) => {
      const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      field.value = value;
      field.dispatchEvent(new Event('input'));
    };
    set('input[formcontrolname="title"]', ' Soup ');
    set('#ingredients-0', '1 onion');
    const addIngredient = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add ingredient'),
    )!;
    addIngredient.click();
    await fixture.whenStable();
    expect(el.querySelector('#ingredients-1')).not.toBeNull();
    set('#directions-0', 'Chop');

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = backend.expectOne('/api/v1/recipes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      recipe: { title: 'Soup', ingredients: ['1 onion'], directions: ['Chop'], notes: '' },
    });
    req.flush({ id: 9, recipe: {} });
    expect(navigate).toHaveBeenCalledWith(['/recipes', 9], {});
  });
});
