import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AccountRequestService } from '../../core/account-request.service';
import { AuthService } from '../../core/auth.service';
import { Home } from './home';

describe('Home, signing up', () => {
  const roles = signal<string[]>([]);
  const refreshRoles = vi.fn(async () => roles.set(['reader']));
  let backend: HttpTestingController;

  beforeEach(() => {
    roles.set([]);
    refreshRoles.mockClear();
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: signal(true),
            isPending: computed(() => !roles().length),
            isMember: computed(() => roles().length > 0),
            displayName: signal('Nina'),
            roles,
            refreshRoles,
            login: vi.fn(),
          },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  async function render(status: object) {
    const fixture = TestBed.createComponent(Home);
    // The API version line at the bottom of the page.
    backend.expectOne('/api/v1/meta').flush(null, { status: 503, statusText: 'Unavailable' });
    const signup = TestBed.inject(AccountRequestService);
    const started = signup.start();
    backend.expectOne('/api/v1/account-requests').flush(status);
    await started;
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function enter(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, code: string) {
    const input = el.querySelector<HTMLInputElement>('#verify-code')!;
    input.value = code;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
  }

  it('asks for the emailed code and lets the account in with it', async () => {
    const { fixture, el } = await render({
      status: 'verify',
      email: 'nina@example.test',
      code_sent_at: '2026-11-21T15:00:00Z',
    });
    expect(el.textContent).toContain('We emailed a 6-digit code to nina@example.test');
    expect(el.textContent).not.toContain('waiting for approval');

    await enter(fixture, el, '123456');
    const req = backend.expectOne('/api/v1/account-requests/verify');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush({ status: 'approved' });
    await fixture.whenStable();

    expect(refreshRoles).toHaveBeenCalled();
    // Let in: the signed-in view takes the place of the sign-up steps.
    expect(el.querySelector('#verify-code')).toBeNull();
    expect(el.querySelector('a[href="/recipes"]')?.textContent).toContain('Open my recipes');
  });

  it('shows why a code was turned away', async () => {
    const { fixture, el } = await render({
      status: 'verify',
      email: 'nina@example.test',
      code_sent_at: '2026-11-21T15:00:00Z',
    });
    await enter(fixture, el, '000000');
    backend
      .expectOne('/api/v1/account-requests/verify')
      .flush(
        { error: 'invalid_code', message: "That code didn't work. Check it and try again." },
        { status: 422, statusText: 'Unprocessable' },
      );
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain("That code didn't work");
    expect(refreshRoles).not.toHaveBeenCalled();
  });

  it('sends a new code on request', async () => {
    const { fixture, el } = await render({
      status: 'verify',
      email: 'nina@example.test',
      code_sent_at: null,
    });
    expect(el.textContent).toContain("We'll email a 6-digit code to nina@example.test");
    button(el, 'Send the code').click();
    backend.expectOne('/api/v1/account-requests/code').flush({
      status: 'verify',
      email: 'nina@example.test',
      code_sent_at: '2026-11-21T15:01:00Z',
    });
    await fixture.whenStable();

    expect(el.textContent).toContain('We sent a new code.');
    expect(button(el, 'Send a new code')).toBeTruthy();
  });

  it('says so when asking too soon', async () => {
    const { fixture, el } = await render({
      status: 'verify',
      email: 'nina@example.test',
      code_sent_at: '2026-11-21T15:00:00Z',
    });
    button(el, 'Send a new code').click();
    backend.expectOne('/api/v1/account-requests/code').flush(
      {
        error: 'too_soon',
        message: 'We just sent a code. Wait a minute before asking for another.',
      },
      { status: 429, statusText: 'Too Many Requests' },
    );
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Wait a minute');
    expect(el.querySelector('#verify-code')).not.toBeNull();
  });

  it('falls back to waiting for an admin when no email can be sent', async () => {
    const { el } = await render({ status: 'pending' });
    expect(el.textContent).toContain('waiting for approval');
    expect(el.querySelector('#verify-code')).toBeNull();
  });
});
