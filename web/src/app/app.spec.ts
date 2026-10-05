import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService } from './core/auth.service';

describe('App', () => {
  const authenticated = signal(false);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: authenticated,
            displayName: computed(() => 'Alice'),
            login: vi.fn(),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  it('offers sign-in when signed out', async () => {
    authenticated.set(false);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sign in');

    // All Recipes works signed out; the rest show greyed, with a reason, and don't link.
    const nav = el.querySelector('.side-nav')!;
    expect(nav.querySelector('a[href="/public"]')?.textContent).toContain('All Recipes');
    const inert = Array.from(nav.querySelectorAll('.disabled'));
    expect(inert.map((e) => e.textContent?.trim())).toEqual(['My Recipes', 'Saved', 'Notes']);
    expect(inert.every((e) => e.tagName === 'SPAN' && e.getAttribute('title'))).toBe(true);
  });

  it('shows the user and the recipes link when signed in', async () => {
    authenticated.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Alice');
    expect(text).toContain('Recipes');
    expect(text).toContain('Notes');
  });
});
