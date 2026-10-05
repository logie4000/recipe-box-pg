import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SaveButton } from './save-button';

describe('SaveButton', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SaveButton],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('saves, then removes, by public code', async () => {
    const fixture = TestBed.createComponent(SaveButton);
    fixture.componentRef.setInput('publicId', 'SoupSoup0002');
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    const save = backend.expectOne('/api/v1/saved-recipes');
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual({ public_id: 'SoupSoup0002' });
    save.flush({ public_id: 'SoupSoup0002', saved: true });
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    const unsave = backend.expectOne('/api/v1/saved-recipes/SoupSoup0002');
    expect(unsave.request.method).toBe('DELETE');
    unsave.flush({ saved: false });
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
