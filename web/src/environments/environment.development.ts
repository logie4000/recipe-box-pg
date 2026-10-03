import { AppEnvironment } from './environment.model';

// ng serve / ng test: Keycloak from docker compose; the APIs are reached
// through proxy.conf.json, so the relative /api paths match production.
export const environment: AppEnvironment = {
  production: false,
  clientVersion: '0.1.0-dev',
  oidc: {
    authority: 'http://localhost:8081/realms/app',
    clientId: 'app-spa',
  },
  readApi: '/api/v1',
  writeApi: '/api/w/v1',
  tenantMode: false,
};
