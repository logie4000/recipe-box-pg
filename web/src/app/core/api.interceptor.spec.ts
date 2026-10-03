import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { of } from 'rxjs';

import { apiInterceptor } from './api.interceptor';
import { TenantService } from './tenant.service';

describe('apiInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: OidcSecurityService, useValue: { getAccessToken: () => of('tok123') } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adds the bearer token and client version to read-api calls', () => {
    http.get('/api/v1/notes').subscribe();
    const req = backend.expectOne('/api/v1/notes');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok123');
    expect(req.request.headers.get('X-Client-Version')).toBeTruthy();
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    req.flush({});
  });

  it('adds the tenant header to write-api calls when a tenant is selected', () => {
    TestBed.inject(TenantService).select('11111111-1111-4111-8111-111111111111');
    http.post('/api/v1/notes', {}).subscribe();
    const req = backend.expectOne('/api/v1/notes');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('11111111-1111-4111-8111-111111111111');
    req.flush({});
  });

  it('never sends the token to other hosts', () => {
    http.get('https://example.com/data').subscribe();
    const req = backend.expectOne('https://example.com/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
