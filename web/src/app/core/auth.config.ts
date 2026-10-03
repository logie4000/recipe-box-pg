import { EnvironmentProviders } from '@angular/core';
import { LogLevel, provideAuth, withAppInitializerAuthCheck } from 'angular-auth-oidc-client';

import { environment } from '../../environments/environment';

/**
 * OIDC Authorization Code + PKCE against Keycloak (public client "app-spa").
 * The access token carries aud=app-api (audience mapper in realm.json), which
 * both APIs require. Tokens are attached by apiInterceptor, not the library.
 */
export function provideOidc(): EnvironmentProviders {
  const scopes = ['openid', 'profile', 'email', 'offline_access'];
  if (environment.tenantMode) {
    scopes.push('organization');
  }

  return provideAuth(
    {
      config: {
        authority: environment.oidc.authority,
        clientId: environment.oidc.clientId,
        redirectUrl: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
        scope: scopes.join(' '),
        responseType: 'code',
        silentRenew: true,
        useRefreshToken: true,
        renewTimeBeforeTokenExpiresInSeconds: 30,
        ignoreNonceAfterRefresh: true,
        logLevel: environment.production ? LogLevel.Warn : LogLevel.Debug,
      },
    },
    withAppInitializerAuthCheck(),
  );
}
