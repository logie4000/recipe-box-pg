import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Approvals } from './approvals';

describe('Approvals', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Approvals],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const button = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  async function load(items: object[]) {
    const fixture = TestBed.createComponent(Approvals);
    await fixture.whenStable();
    backend.expectOne('/api/v1/account-requests').flush({ items });
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lists sign-ups and approves one', async () => {
    const { fixture, el } = await load([
      { id: 3, name: 'Nina New', email: 'nina@example.test', created_at: '2026-10-06T15:00:00Z' },
    ]);
    expect(el.textContent).toContain('Nina New');

    button(el, 'Approve').click();
    const req = backend.expectOne('/api/v1/account-requests/3/approve');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 3 });
    await fixture.whenStable();

    expect(el.textContent).toContain('Nobody is waiting');
  });

  it('declines after confirming, and keeps the row if the server fails', async () => {
    const { fixture, el } = await load([
      { id: 4, name: null, email: 'x@example.test', created_at: '2026-10-06T15:00:00Z' },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    button(el, 'Decline').click();
    const req = backend.expectOne('/api/v1/account-requests/4');
    expect(req.request.method).toBe('DELETE');
    req.flush(
      { error: 'keycloak', message: "Couldn't reach the sign-in server. Try again." },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('sign-in server');
    expect(el.textContent).toContain('x@example.test');
  });
});
