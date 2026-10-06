import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { BehaviorSubject, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';

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

  /** Bumped after a forced token refresh, so roles are read again. */
  private readonly tokenRefreshed = new BehaviorSubject(0);

  private readonly accessPayload = toSignal(
    combineLatest([this.oidc.isAuthenticated$, this.tokenRefreshed]).pipe(
      switchMap(([r]) =>
        r.isAuthenticated ? this.oidc.getPayloadFromAccessToken() : of({} as AccessTokenPayload),
      ),
      map((p) => (p ?? {}) as AccessTokenPayload),
    ),
    { initialValue: {} as AccessTokenPayload },
  );

  /** Keycloak realm roles: reader, editor, admin. */
  readonly roles = computed(() => this.accessPayload().realm_access?.roles ?? []);
  readonly canEdit = computed(() => this.roles().some((r) => r === 'editor' || r === 'admin'));
  /**
   * Let in by an admin. Anyone can sign up, but a new account has no role and
   * can only browse until it is approved (which grants reader).
   */
  readonly isMember = computed(() =>
    this.roles().some((r) => r === 'reader' || r === 'editor' || r === 'admin'),
  );
  /** Signed in, but not approved yet. */
  readonly isPending = computed(() => this.isAuthenticated() && !this.isMember());
  readonly isAdmin = computed(() => this.roles().includes('admin'));

  /** Fetches a fresh token, e.g. to pick up an approval without signing out. */
  async refreshRoles(): Promise<void> {
    await firstValueFrom(this.oidc.forceRefreshSession());
    this.tokenRefreshed.next(this.tokenRefreshed.value + 1);
  }

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
