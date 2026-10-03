import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map, take } from 'rxjs';

import { AuthService } from './auth.service';

/** Sends signed-out users to Keycloak, then back to the app. */
export const authGuard: CanActivateFn = () => {
  const oidc = inject(OidcSecurityService);
  return oidc.isAuthenticated$.pipe(
    take(1),
    map(({ isAuthenticated }) => {
      if (!isAuthenticated) {
        oidc.authorize();
      }
      return isAuthenticated;
    }),
  );
};

/** Hides routes from users without one of the given realm roles (the API still enforces this). */
export function roleGuard(...roles: string[]): CanActivateFn {
  return () =>
    inject(AuthService)
      .roles()
      .some((r) => roles.includes(r));
}
