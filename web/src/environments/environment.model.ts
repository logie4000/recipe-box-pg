export interface AppEnvironment {
  production: boolean;
  /** Sent as X-Client-Version; compare with GET /api/v1/meta min_supported_version. */
  clientVersion: string;
  oidc: { authority: string; clientId: string };
  /** REST base path. GETs are served by the Go read-api, writes by the Rails write-api. */
  api: string;
  /** Must match TENANT_MODE on the APIs. Adds the Keycloak "organization" scope. */
  tenantMode: boolean;
}
