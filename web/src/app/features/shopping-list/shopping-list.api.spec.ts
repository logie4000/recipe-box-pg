import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ShoppingListApi } from './shopping-list.api';

describe('ShoppingListApi', () => {
  let api: ShoppingListApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ShoppingListApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('reads with GET and writes with POST, PATCH and DELETE', () => {
    api.getShoppingList().subscribe();
    expect(backend.expectOne('/api/v1/shopping-list').request.method).toBe('GET');

    api.addToShoppingList('abc123def456').subscribe();
    let req = backend.expectOne('/api/v1/shopping-list/recipes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ public_id: 'abc123def456' });

    api.addToShoppingList('abc123def456', 2).subscribe();
    req = backend.expectOne('/api/v1/shopping-list/recipes');
    expect(req.request.body).toEqual({ public_id: 'abc123def456', servings: 2 });

    api.setServings('abc123def456', 0.5).subscribe();
    req = backend.expectOne('/api/v1/shopping-list/recipes/abc123def456');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ servings: 0.5 });

    api.removeFromShoppingList('abc123def456').subscribe();
    req = backend.expectOne('/api/v1/shopping-list/recipes/abc123def456');
    expect(req.request.method).toBe('DELETE');

    api.clearShoppingList().subscribe();
    req = backend.expectOne('/api/v1/shopping-list');
    expect(req.request.method).toBe('DELETE');
  });
});
