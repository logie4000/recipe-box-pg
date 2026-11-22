import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ShoppingListButton } from './shopping-list-button';

describe('ShoppingListButton', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ShoppingListButton],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  async function create(onList?: boolean) {
    const fixture = TestBed.createComponent(ShoppingListButton);
    fixture.componentRef.setInput('publicId', 'SoupSoup0002');
    if (onList !== undefined) {
      fixture.componentRef.setInput('onList', onList);
    }
    await fixture.whenStable();
    return fixture;
  }

  it('looks itself up on the list, adds, then removes on a second click', async () => {
    const fixture = await create();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector('button')!;
    expect(button.disabled).toBe(true);

    backend.expectOne('/api/v1/shopping-list').flush({
      recipes: [{ public_id: 'OtherOther01', title: 'Other', servings: 1, mine: true }],
      items: [],
    });
    await fixture.whenStable();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('Add to shopping list');

    button.click();
    const add = backend.expectOne('/api/v1/shopping-list/recipes');
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ public_id: 'SoupSoup0002' });
    add.flush(
      { public_id: 'SoupSoup0002', servings: 1, on_list: true },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('On shopping list');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/shopping-list');

    button.click();
    const remove = backend.expectOne('/api/v1/shopping-list/recipes/SoupSoup0002');
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ public_id: 'SoupSoup0002', on_list: false });
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('a')).toBeNull();
  });

  it('skips the lookup when the page already knows, and says when the list is full', async () => {
    const fixture = await create(false);
    backend.expectNone('/api/v1/shopping-list');
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('button')!.click();
    backend
      .expectOne('/api/v1/shopping-list/recipes')
      .flush({ error: 'invalid' }, { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();
    expect(el.querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('full');
  });
});
