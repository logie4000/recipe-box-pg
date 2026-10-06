import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService } from './core/auth.service';

describe('App', () => {
  const authenticated = signal(false);
  const roles = signal<string[]>([]);
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: authenticated,
            isMember: computed(() => authenticated() && roles().length > 0),
            isPending: computed(() => authenticated() && !roles().length),
            isAdmin: computed(() => roles().includes('admin')),
            displayName: computed(() => 'Alice'),
            login: vi.fn(),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const nav = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('.side-nav')!;

  it('offers sign-in when signed out', async () => {
    authenticated.set(false);
    roles.set([]);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Sign in');

    // All Recipes works signed out; the rest show greyed, with a reason, and don't link.
    expect(nav(fixture).querySelector('a[href="/public"]')?.textContent).toContain('All Recipes');
    const inert = Array.from(nav(fixture).querySelectorAll('.disabled'));
    expect(inert.map((e) => e.textContent?.trim())).toEqual(['My Recipes', 'Saved', 'Notes']);
    expect(inert.every((e) => e.tagName === 'SPAN' && e.getAttribute('title'))).toBe(true);
  });

  it('shows the user and the recipes link when signed in and approved', async () => {
    authenticated.set(true);
    roles.set(['reader']);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Alice');
    expect(nav(fixture).querySelector('a[href="/recipes"]')).not.toBeNull();
    expect(nav(fixture).querySelector('a[href="/approvals"]')).toBeNull();
  });

  it('shows Approvals to admins', async () => {
    authenticated.set(true);
    roles.set(['admin']);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(nav(fixture).querySelector('a[href="/approvals"]')?.textContent).toContain('Approvals');
  });

  it('greys out the menu for a new account and asks to be let in', async () => {
    authenticated.set(true);
    roles.set([]);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const req = backend.expectOne('/api/v1/account-requests');
    expect(req.request.method).toBe('POST');
    req.flush({ status: 'pending' });

    const inert = Array.from(nav(fixture).querySelectorAll('.disabled'));
    expect(inert.map((e) => e.getAttribute('title'))).toEqual(
      Array(3).fill('Waiting for approval'),
    );
  });
});
