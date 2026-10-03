import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map, of, switchMap } from 'rxjs';

interface AccessTokenPayload {
  sub?: string;
  realm_access?: { roles?: string[] };
}

/** Signals over angular-auth-oidc-client for components and guards. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly oidc = inject(OidcSecurityService);

  readonly isAuthenticated = toSignal(
    this.oidc.isAuthenticated$.pipe(map((r) => r.isAuthenticated)),
    {
      initialValue: false,
    },
  );

  readonly userData = toSignal(
    this.oidc.userData$.pipe(map((r) => r.userData as Record<string, unknown> | null)),
    {
      initialValue: null,
    },
  );

  readonly displayName = computed(() => {
    const u = this.userData();
    return (u?.['name'] ?? u?.['preferred_username'] ?? '') as string;
  });

  private readonly accessPayload = toSignal(
    this.oidc.isAuthenticated$.pipe(
      switchMap((r) =>
        r.isAuthenticated ? this.oidc.getPayloadFromAccessToken() : of({} as AccessTokenPayload),
      ),
      map((p) => (p ?? {}) as AccessTokenPayload),
    ),
    { initialValue: {} as AccessTokenPayload },
  );

  /** Keycloak realm roles: reader, editor, admin. */
  readonly roles = computed(() => this.accessPayload().realm_access?.roles ?? []);
  readonly canEdit = computed(() => this.roles().some((r) => r === 'editor' || r === 'admin'));

  /** Redirects to Keycloak. idpHint 'google' skips straight to Google (when enabled in Keycloak). */
  login(idpHint?: string): void {
    this.oidc.authorize(
      undefined,
      idpHint ? { customParams: { kc_idp_hint: idpHint } } : undefined,
    );
  }

  logout(): void {
    this.oidc.logoff().subscribe();
  }
}
