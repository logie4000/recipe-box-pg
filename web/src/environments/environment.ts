import { AppEnvironment } from './environment.model';

// Production settings. Replace the placeholders when stamping out an app
// (or have the deploy pipeline template them).
export const environment: AppEnvironment = {
  production: true,
  clientVersion: '0.1.0',
  oidc: {
    authority: 'https://auth.example.com/realms/app',
    clientId: 'app-spa',
  },
  // Same origin behind nginx: GET /api/v1 -> Go read-api, /api/w/v1 -> Rails write-api.
  readApi: '/api/v1',
  writeApi: '/api/w/v1',
  tenantMode: false,
};
