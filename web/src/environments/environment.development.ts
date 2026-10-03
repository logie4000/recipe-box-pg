import { AppEnvironment } from './environment.model';

// ng serve / ng test: Keycloak from docker compose; the APIs are reached
// through proxy.conf.mjs (split by method, like nginx), so the relative /api
// paths match production.
export const environment: AppEnvironment = {
  production: false,
  clientVersion: '0.1.0-dev',
  oidc: {
    authority: 'http://localhost:8081/realms/app',
    clientId: 'app-spa',
  },
  api: '/api/v1',
  tenantMode: false,
};
