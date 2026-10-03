import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { switchMap, take } from 'rxjs';

import { environment } from '../../environments/environment';
import { TenantService } from './tenant.service';

const API_PREFIXES = [environment.readApi, environment.writeApi];

/**
 * For calls to our APIs only: adds the bearer token, X-Client-Version (logged
 * by both APIs; mobile builds rely on it) and, in tenant mode, X-Tenant-Id.
 * Requests to anything else pass through untouched, so the token never leaks.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!API_PREFIXES.some((p) => req.url.startsWith(p))) {
    return next(req);
  }
  const oidc = inject(OidcSecurityService);
  const tenant = inject(TenantService).selected();

  return oidc.getAccessToken().pipe(
    take(1),
    switchMap((token) => {
      const headers: Record<string, string> = { 'X-Client-Version': environment.clientVersion };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (tenant) {
        headers['X-Tenant-Id'] = tenant;
      }
      return next(req.clone({ setHeaders: headers }));
    }),
  );
};
