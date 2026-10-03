import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { RecipesApi } from './recipes.api';

describe('RecipesApi', () => {
  let api: RecipesApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(RecipesApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it("reads the caller's recipes with GET", () => {
    api.list(24, 48).subscribe();
    const list = backend.expectOne((r) => r.url === '/api/v1/recipes');
    expect(list.request.method).toBe('GET');
    expect(list.request.params.get('limit')).toBe('24');
    expect(list.request.params.get('offset')).toBe('48');
    list.flush({ items: [], total: 0, limit: 24, offset: 48 });

    api.get(7).subscribe();
    expect(backend.expectOne('/api/v1/recipes/7').request.method).toBe('GET');
  });

  it('writes with POST, PATCH and DELETE under the same URLs', () => {
    const body = { title: 'Soup', ingredients: ['1 onion'], directions: ['Chop'] };
    api.create(body).subscribe();
    const create = backend.expectOne('/api/v1/recipes');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ recipe: body });
    create.flush({ id: 7 });

    api.setPublic(7, true).subscribe();
    const share = backend.expectOne('/api/v1/recipes/7');
    expect(share.request.method).toBe('PATCH');
    expect(share.request.body).toEqual({ recipe: { is_public: true } });
    share.flush({});

    api.delete(7).subscribe();
    expect(backend.expectOne('/api/v1/recipes/7').request.method).toBe('DELETE');
  });

  it("uploads the photo as multipart, and fetches the owner's copy as a blob", () => {
    api.uploadImage(7, new Blob(['jpeg'], { type: 'image/jpeg' })).subscribe();
    const upload = backend.expectOne('/api/v1/recipes/7/image');
    expect(upload.request.method).toBe('PUT');
    expect((upload.request.body as FormData).get('image')).toBeInstanceOf(Blob);
    upload.flush({});

    api.deleteImage(7).subscribe();
    expect(backend.expectOne('/api/v1/recipes/7/image').request.method).toBe('DELETE');

    api.imageBlob(7).subscribe();
    const blob = backend.expectOne('/api/v1/recipes/7/image');
    expect(blob.request.responseType).toBe('blob');
    blob.flush(new Blob());
  });

  it('builds public URLs from the 12-character code, never the id', () => {
    api.getPublic('k7Xq2mP9vR4t').subscribe();
    expect(backend.expectOne('/api/v1/public/recipes/k7Xq2mP9vR4t').request.method).toBe('GET');
    expect(api.publicImageUrl('k7Xq2mP9vR4t')).toBe('/api/v1/public/recipes/k7Xq2mP9vR4t/image');
    expect(api.shareUrl('k7Xq2mP9vR4t')).toBe(`${window.location.origin}/r/k7Xq2mP9vR4t`);
  });
});
