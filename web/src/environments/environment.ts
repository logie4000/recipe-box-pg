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
  // Same origin behind nginx, which splits /api/v1 by method: GET -> Go
  // read-api, POST/PATCH/PUT/DELETE -> Rails write-api.
  api: '/api/v1',
  tenantMode: false,
};
