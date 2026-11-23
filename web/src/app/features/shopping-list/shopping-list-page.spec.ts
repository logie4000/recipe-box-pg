import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { listText, servingsLabel, ShoppingListPage, TICKS_KEY } from './shopping-list-page';
import { ShoppingList } from './shopping-list.api';

const LIST: ShoppingList = {
  recipes: [
    { public_id: 'Pancakes0001', title: 'Pancakes', servings: 1, mine: true },
    { public_id: 'Bread0000002', title: 'Bread', servings: 2, mine: false },
  ],
  items: [
    {
      key: 'egg',
      name: 'egg',
      amounts: [{ quantity: 2, unit: '', text: '2' }],
      sources: [{ public_id: 'Pancakes0001', title: 'Pancakes', line: '2 eggs' }],
    },
    {
      key: 'flour',
      name: 'flour',
      amounts: [
        { quantity: 3.5, unit: 'cup', text: '3 1/2 cups' },
        { quantity: 100, unit: 'g', text: '100 g' },
      ],
      sources: [
        { public_id: 'Pancakes0001', title: 'Pancakes', line: '2 cups all-purpose flour' },
        { public_id: 'Bread0000002', title: 'Bread', line: '50 g flour' },
      ],
    },
    {
      key: 'salt',
      name: 'salt',
      amounts: [],
      sources: [{ public_id: 'Bread0000002', title: 'Bread', line: 'salt to taste' }],
    },
  ],
};

const own = (id: number, publicId: string, title: string) => ({
  id,
  public_id: publicId,
  title,
  ingredients: [],
  directions: [],
  notes: '',
  author_name: 'Me',
  image_key: null,
  is_public: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const saved = (publicId: string, title: string) => ({
  public_id: publicId,
  title,
  author_name: 'Bob',
  image_key: null,
  ingredient_count: 1,
  direction_count: 1,
  saved_at: '2026-10-01T00:00:00Z',
});

describe('ShoppingListPage', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    try {
      localStorage.removeItem(TICKS_KEY);
    } catch {
      // ignore
    }
    TestBed.configureTestingModule({
      imports: [ShoppingListPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  function flushList(list: ShoppingList) {
    const req = backend.expectOne((r) => r.url === '/api/v1/shopping-list' && r.method === 'GET');
    req.flush(list);
  }

  async function load(list: ShoppingList = LIST) {
    const fixture = TestBed.createComponent(ShoppingListPage);
    await fixture.whenStable();
    flushList(list);
    backend
      .expectOne((r) => r.url === '/api/v1/recipes')
      .flush({
        items: [own(7, 'Pancakes0001', 'Pancakes'), own(8, 'Waffles00003', 'Waffles')],
        total: 2,
        limit: 100,
        offset: 0,
      });
    backend.expectOne('/api/v1/saved-recipes').flush({
      items: [saved('Bread0000002', 'Bread'), saved('Chili0000004', 'Chili')],
    });
    await fixture.whenStable();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<ShoppingListPage>, list: ShoppingList = LIST) {
    await fixture.whenStable();
    flushList(list);
    await fixture.whenStable();
  }

  const buttonByText = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => text(b) === label)!;

  it('explains how to add recipes when the list is empty, with the picker open', async () => {
    const el = (await load({ recipes: [], items: [] })).nativeElement as HTMLElement;
    expect(text(el.querySelector('[data-testid="empty"]'))).toContain(
      'Your shopping list is empty',
    );
    expect(el.querySelector('[data-testid="picker"]')).not.toBeNull();
    expect(text(el)).not.toContain('Copy list');
  });

  it('lists the recipes with links and multipliers, and the combined items', async () => {
    const el = (await load()).nativeElement as HTMLElement;
    const rows = Array.from(el.querySelectorAll('.rows li'));
    expect(rows.map((r) => text(r.querySelector('a')))).toEqual(['Pancakes', 'Bread']);
    // Your own recipe opens on its own page; a saved one on the public page.
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/recipes/7');
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/r/Bread0000002');
    expect(text(rows[1].querySelector('output'))).toBe('2×');

    const items = Array.from(el.querySelectorAll('[data-testid="to-get"] > li'));
    expect(
      items.map((i) => [text(i.querySelector('.name')), text(i.querySelector('.amounts'))]),
    ).toEqual([
      ['egg', '2'],
      ['flour', '3 1/2 cups + 100 g'],
      ['salt', undefined],
    ]);
    const from = items[1].querySelector('details')!;
    expect(text(from.querySelector('summary'))).toBe('from Pancakes, Bread');
    expect(text(from.querySelector('ul'))).toContain('Bread: 50 g flour');
    // The picker starts closed when there's something on the list.
    expect(el.querySelector('[data-testid="picker"]')).toBeNull();
  });

  it('changes the multiplier in steps and reloads the combined list', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    const bread = el.querySelectorAll('.rows li')[1];
    bread.querySelector<HTMLButtonElement>('button[aria-label="Less"]')!.click();
    const patch = backend.expectOne('/api/v1/shopping-list/recipes/Bread0000002');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ servings: 1.5 });
    patch.flush({ public_id: 'Bread0000002', servings: 1.5, on_list: true });
    await settle(fixture, {
      ...LIST,
      recipes: [LIST.recipes[0], { ...LIST.recipes[1], servings: 1.5 }],
    });
    expect(text(el.querySelectorAll('.rows li')[1].querySelector('output'))).toBe('1½×');

    el.querySelectorAll('.rows li')[0]
      .querySelector<HTMLButtonElement>('button[aria-label="More"]')!
      .click();
    expect(backend.expectOne('/api/v1/shopping-list/recipes/Pancakes0001').request.body).toEqual({
      servings: 1.5,
    });
  });

  it('removes a recipe', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[aria-label="Remove Bread"]')!.click();
    const del = backend.expectOne('/api/v1/shopping-list/recipes/Bread0000002');
    expect(del.request.method).toBe('DELETE');
    del.flush({ public_id: 'Bread0000002', on_list: false });
    await settle(fixture, { recipes: [LIST.recipes[0]], items: [LIST.items[0]] });
    expect(el.querySelectorAll('.rows li').length).toBe(1);
  });

  it('clears the list only after an inline confirm', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    const confirmSpy = vi.spyOn(window, 'confirm');

    buttonByText(el, 'Clear list').click();
    await fixture.whenStable();
    backend.expectNone((r) => r.method === 'DELETE');
    expect(text(el)).toContain('Remove all 2?');

    buttonByText(el, 'Cancel').click();
    await fixture.whenStable();
    expect(text(el)).not.toContain('Remove all 2?');

    buttonByText(el, 'Clear list').click();
    await fixture.whenStable();
    buttonByText(el, 'Yes, clear list').click();
    const del = backend.expectOne('/api/v1/shopping-list');
    expect(del.request.method).toBe('DELETE');
    del.flush({ cleared: 2 });
    await settle(fixture, { recipes: [], items: [] });
    expect(el.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('ticks items off into "Got it" and remembers them on this browser', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelectorAll<HTMLInputElement>(
      '[data-testid="to-get"] input[type="checkbox"]',
    )[1].click();
    await fixture.whenStable();

    const names = (id: string) =>
      Array.from(el.querySelectorAll(`[data-testid="${id}"] .name`)).map((n) => text(n));
    expect(names('to-get')).toEqual(['egg', 'salt']);
    expect(names('got-it')).toEqual(['flour']);
    expect(JSON.parse(localStorage.getItem(TICKS_KEY)!)).toEqual(['flour']);

    // A fresh visit starts with the same ticks.
    fixture.destroy();
    const second = await load();
    const again = second.nativeElement as HTMLElement;
    expect(
      Array.from(again.querySelectorAll('[data-testid="got-it"] .name')).map((n) => text(n)),
    ).toEqual(['flour']);

    // Unticking puts it back.
    again.querySelector<HTMLInputElement>('[data-testid="got-it"] input')!.click();
    await second.whenStable();
    expect(again.querySelector('[data-testid="got-it"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(TICKS_KEY)!)).toEqual([]);
  });

  it('adds several picked recipes at once; ones already on the list are checked and locked', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    buttonByText(el, '▸ Add recipes').click();
    await fixture.whenStable();

    const boxes = () =>
      new Map(
        Array.from(el.querySelectorAll<HTMLLabelElement>('.choices label')).map((l) => [
          text(l)!.replace(' (on list)', ''),
          l.querySelector('input')!,
        ]),
      );
    expect(boxes().get('Pancakes')!.checked).toBe(true);
    expect(boxes().get('Pancakes')!.disabled).toBe(true);
    expect(boxes().get('Bread')!.disabled).toBe(true);
    expect(boxes().get('Waffles')!.disabled).toBe(false);

    boxes().get('Waffles')!.click();
    boxes().get('Chili')!.click();
    await fixture.whenStable();
    buttonByText(el, 'Add 2 recipes').click();

    const posts = backend.match('/api/v1/shopping-list/recipes');
    expect(posts.map((p) => p.request.body)).toEqual([
      { public_id: 'Waffles00003' },
      { public_id: 'Chili0000004' },
    ]);
    posts.forEach((p) =>
      p.flush({ public_id: p.request.body.public_id, servings: 1, on_list: true }),
    );
    await settle(fixture, {
      recipes: [
        ...LIST.recipes,
        { public_id: 'Chili0000004', title: 'Chili', servings: 1, mine: false },
        { public_id: 'Waffles00003', title: 'Waffles', servings: 1, mine: true },
      ],
      items: LIST.items,
    });
    expect(el.querySelectorAll('.rows li').length).toBe(4);
    expect(boxes().get('Waffles')!.disabled).toBe(true);
    expect(text(buttonByText(el, 'Add 0 recipes'))).toBe('Add 0 recipes');
  });

  it('copies the unticked items as plain text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    localStorage.setItem(TICKS_KEY, JSON.stringify(['egg']));
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    buttonByText(el, 'Copy list').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith(
      'Shopping list\n\n- flour: 3 1/2 cups + 100 g\n- salt\n',
    );
    await fixture.whenStable();
    expect(text(el)).toContain('Copied!');
  });

  it('labels multipliers with fractions', () => {
    expect([0.25, 0.5, 1, 1.5, 2, 1.2].map(servingsLabel)).toEqual([
      '¼×',
      '½×',
      '1×',
      '1½×',
      '2×',
      '1.2×',
    ]);
    expect(listText([])).toBe('Shopping list\n\n\n');
  });
});
