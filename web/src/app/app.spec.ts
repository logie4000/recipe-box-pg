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
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sign in');
  });

  it('shows the user and the recipes link when signed in', async () => {
    authenticated.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Alice');
    expect(text).toContain('My recipes');
    expect(text).toContain('Notes');
  });
});
