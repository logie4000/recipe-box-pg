import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { PublicRecipePage } from './public-recipe';

describe('PublicRecipePage', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicRecipePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated: signal(false), login: vi.fn() } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  async function open(code: string) {
    const fixture = TestBed.createComponent(PublicRecipePage);
    fixture.componentRef.setInput('code', code);
    await fixture.whenStable();
    return fixture;
  }

  it('shows a shared recipe read-only, with the photo from the public URL', async () => {
    const fixture = await open('k7Xq2mP9vR4t');
    backend.expectOne('/api/v1/public/recipes/k7Xq2mP9vR4t').flush({
      public_id: 'k7Xq2mP9vR4t',
      title: 'Soup',
      ingredients: ['1 onion'],
      directions: ['Chop', 'Simmer'],
      notes: 'Better the next day.',
      image_key: 'recipes/abcdefghijklmnopqrstuvwx.jpg',
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Soup');
    expect(el.querySelectorAll('ol li').length).toBe(2);
    expect(el.querySelector('.notes')?.textContent).toContain('Better the next day.');
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/public/recipes/k7Xq2mP9vR4t/image',
    );
    // Read-only: no form fields, and the only button is Export.
    expect(el.querySelector('input, textarea')).toBeNull();
    expect(
      Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Export']);
  });

  it('says the same thing for private, deleted and unknown recipes', async () => {
    const fixture = await open('NoSuchRecipe');
    backend
      .expectOne('/api/v1/public/recipes/NoSuchRecipe')
      .flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Recipe not available');
  });
});
