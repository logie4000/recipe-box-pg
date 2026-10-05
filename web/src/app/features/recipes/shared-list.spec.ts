import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

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

  beforeEach(() => {
    try {
      localStorage.removeItem('recipe-box.shared-view');
    } catch {
      // ignore
    }
    TestBed.configureTestingModule({
      imports: [SharedList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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
    await fixture.whenStable();
    return fixture;
  }

  it('lists every shared recipe by title, with authors and the caller’s own marked', async () => {
    const el = (await load()).nativeElement as HTMLElement;
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
    expect(rows.length).toBe(4);
    expect(rows[0]).toContain('Apple pie');
    expect(rows[0]).toContain('Bob B');
    expect(rows[1]).toContain('Yours');
    expect(rows[2]).toContain('Unknown author');
  });

  it('switches to authors as twisties that show and hide their recipes', async () => {
    const fixture = await load();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLInputElement>('[data-testid="view-switch"]')!.click();
    await fixture.whenStable();

    const titles = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.twistie-title')).map((b) =>
        b.textContent!.replace(/\s+/g, ' ').trim(),
      );
    expect(titles()).toEqual(['▸ Alice A (1)', '▸ Bob B (2)', '▸ Unknown author (1)']);
    expect(el.querySelectorAll('tbody tr').length).toBe(0);

    el.querySelectorAll<HTMLButtonElement>('.twistie-title')[1].click();
    await fixture.whenStable();
    const bobs = Array.from(el.querySelectorAll('tbody tr')).map((tr) => tr.textContent);
    expect(bobs.length).toBe(2);
    expect(bobs[0]).toContain('Apple pie');
    expect(bobs[1]).toContain('Toast');

    el.querySelectorAll<HTMLButtonElement>('.twistie-title')[1].click();
    await fixture.whenStable();
    expect(el.querySelectorAll('tbody tr').length).toBe(0);
  });
});
