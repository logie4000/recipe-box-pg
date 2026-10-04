import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Recipe } from './recipes.api';
import { SharePanel } from './share-panel';

const recipe: Recipe = {
  id: 3,
  public_id: 'k7Xq2mP9vR4t',
  title: 'Soup',
  ingredients: [],
  directions: [],
  image_key: null,
  is_public: false,
  created_at: '',
  updated_at: '',
};

describe('SharePanel', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SharePanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  async function panel(r: Recipe) {
    const fixture = TestBed.createComponent(SharePanel);
    fixture.componentRef.setInput('recipe', r);
    await fixture.whenStable();
    return fixture;
  }

  it('shows no link while private, and makes the recipe public when switched on', async () => {
    const fixture = await panel(recipe);
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.switch')?.getAttribute('title')).toContain(
      'Only you can see this recipe',
    );
    expect(el.querySelector('input[readonly]')).toBeNull();

    const toggle = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const req = backend.expectOne('/api/v1/recipes/3');
    expect(req.request.body).toEqual({ recipe: { is_public: true } });
    req.flush({ id: 3, recipe: { ...recipe, is_public: true } });
    expect(changed).toHaveBeenCalledWith({ ...recipe, is_public: true });
  });

  it('shows the share link built from the public code when public', async () => {
    const fixture = await panel({ ...recipe, is_public: true });
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[readonly]',
    )!;
    expect(link.value).toBe(`${window.location.origin}/r/k7Xq2mP9vR4t`);
  });

  it('puts the switch back when the change fails', async () => {
    const fixture = await panel(recipe);
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    backend.expectOne('/api/v1/recipes/3').flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(toggle.checked).toBe(false);
    expect(el.textContent).toContain('Could not change sharing');
  });
});
