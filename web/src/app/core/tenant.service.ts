import { Injectable, signal } from '@angular/core';

/**
 * TENANT_MODE only: the tenant (Keycloak organization id) the user is acting
 * in. Needed when a user belongs to several organizations; the APIs answer
 * 403 if it is not one of theirs. Unused (null) when tenant mode is off.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly selected = signal<string | null>(null);

  select(tenantId: string | null): void {
    this.selected.set(tenantId);
  }
}
