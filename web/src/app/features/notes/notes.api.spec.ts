import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NotesApi } from './notes.api';

describe('NotesApi', () => {
  let api: NotesApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(NotesApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('reads from the Go read-api', () => {
    api.list(10, 20).subscribe();
    const req = backend.expectOne((r) => r.url === '/api/v1/notes');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('20');
    req.flush({ items: [], total: 0, limit: 10, offset: 20 });
  });

  it('writes to the Rails write-api', () => {
    api.create({ title: 'T', body: 'B' }).subscribe((r) => expect(r.id).toBe(7));
    const create = backend.expectOne('/api/w/v1/notes');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ note: { title: 'T', body: 'B' } });
    create.flush({ id: 7 });

    api.update(7, { title: 'U', body: '' }).subscribe();
    expect(backend.expectOne('/api/w/v1/notes/7').request.method).toBe('PATCH');

    api.delete(7).subscribe();
    expect(backend.expectOne('/api/w/v1/notes/7').request.method).toBe('DELETE');
  });
});
