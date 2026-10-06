import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { SharedList } from './shared-list';

const shared = (code: string, title: string, author: string | null, mine = false) => ({
  public_id: code.padEnd(12, 'x'),
  title,
  author_name: author,
  image_key: null,
  ingredient_count: 2,
  direction_count: 1,
  mine,
  updated_at: '2026-10-01T00:00:00Z',
});

describe('SharedList', () => {
  let backend: HttpTestingController;
  const authenticated = signal(true);

  beforeEach(() => {
    authenticated.set(true);
    try {
      localStorage.removeItem('recipe-box.shared-view');
    } catch {
      // ignore
    }
    TestBed.configureTestingModule({
      imports: [SharedList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { isAuthenticated: authenticated, isMember: authenticated, login: vi.fn() },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  async function load() {
    const fixture = TestBed.createComponent(SharedList);
    await fixture.whenStable();
    backend
      .expectOne((r) => r.url === '/api/v1/shared-recipes')
      .flush({
        items: [
          shared('a', 'Apple pie', 'Bob B'),
          shared('c', 'Chili', 'Alice A', true),
          shared('s', 'Soup', null),
          shared('t', 'Toast', 'Bob B'),
        ],
        total: 4,
        limit: 1000,
        offset: 0,
      });
    if (authenticated()) {
      backend.expectOne('/api/v1/saved-recipes').flush({ items: [shared('t', 'Toast', 'Bob B')] });
    }
    await fixture.whenStable();
    return fixture;
  }

  const cards = (el: HTMLElement) => Array.from(el.querySelectorAll('app-recipe-card'));

  it('shows every public recipe as a card by title, with authors and bookmarks', async () => {
    const el = (await load()).nativeElement as HTMLElement;
    const all = cards(el);
    expect(all.map((c) => c.querySelector('.title')?.textContent?.trim())).toEqual([
      'Apple pie',
      'Chili',
      'Soup',
      'Toast',
    ]);
    expect(all[0].textContent).toContain('by Bob B');
    expect(all[2].textContent).toContain('by Unknown author');
    expect(all[0].querySelector('a')?.getAttribute('href')).toBe('/r/axxxxxxxxxxx');

    // Your own recipe: a "Yours" tag and no bookmark. Others: a bookmark, filled if saved.
    expect(all[1].textContent).toContain('Yours');
    expect(all[1].querySelector('app-save-button')).toBeNull();
    const pressed = (c: Element) =>
      c.querySelector('app-save-button button')?.getAttribute('aria-pressed');
    expect(pressed(all[0])).toBe('false');
    expect(pressed(all[3])).toBe('true');
  });

  it('switches to authors as twisties that show and hide their cards', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLInputElement>('[data-testid="view-switch"]')!.click();
    await fixture.whenStable();

    const titles = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.twistie-title')).map((b) =>
        b.textContent!.replace(/\s+/g, ' ').trim(),
      );
    expect(titles()).toEqual(['▸ Alice A (1)', '▸ Bob B (2)', '▸ Unknown author (1)']);
    expect(cards(el).length).toBe(0);

    el.querySelectorAll<HTMLButtonElement>('.twistie-title')[1].click();
    await fixture.whenStable();
    const bobs = cards(el);
    expect(bobs.map((c) => c.querySelector('.title')?.textContent?.trim())).toEqual([
      'Apple pie',
      'Toast',
    ]);
    // Inside an author's group the byline would repeat the heading, so it's left off.
    expect(bobs[0].textContent).not.toContain('by Bob B');

    el.querySelectorAll<HTMLButtonElement>('.twistie-title')[1].click();
    await fixture.whenStable();
    expect(cards(el).length).toBe(0);
  });

  it('works signed out: same cards, no bookmarks, and a nudge to sign in', async () => {
    authenticated.set(false);
    const el = (await load()).nativeElement as HTMLElement;
    expect(cards(el).length).toBe(4);
    expect(el.querySelector('app-save-button')).toBeNull();
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('Sign in to save recipes you like');
  });
});
