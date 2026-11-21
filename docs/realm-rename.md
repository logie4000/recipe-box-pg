# Renaming the Keycloak realm from "app" to "recipe-box"

One-off. The realm is renamed in place (`deploy/keycloak/configure.sh
rename-realm`), so every user keeps their Keycloak id (the app's database
stores it as the owner of their recipes), password, roles, Google link and
approval state. Clients, the rails-admin service account, sign-up settings and
the Google IdP settings stay as they are. Only the URLs change, from
`/realms/app/...` to `/realms/recipe-box/...`, so:

- everyone is signed out once and signs in again;
- the Google OAuth client needs the new redirect URI;
- the app has to run images built with the new name right after the rename
  (the old images look for `/realms/app`, which then returns 404).

Sweat Equity has its own realm (`sweat-equity`) and isn't affected.

## Production (Denali)

Sign-in is down for Recipe Box between step 3 and the end of step 4, about a
minute.

**1. Google** (any time before step 3). Google Cloud console > APIs & Services
> Credentials > the Recipe Box OAuth client > Authorized redirect URIs > add

    https://auth.specialbrew.net/realms/recipe-box/broker/google/endpoint

Keep the old `/realms/app/...` one until this is done, then remove it.

**2. Merge the PR** and wait for the Images workflow on `main` to finish. Note
its commit SHA.

**3. On Denali, safety copy, then rename:**

```bash
cd /srv/infra-core && docker compose -p infra-core exec backup backup.sh once   # keycloak database to S3
cd /srv/recipe-box && git pull
deploy/keycloak/configure.sh rename-realm
```

It prints `realm app renamed to recipe-box` and
`role default-roles-app renamed to default-roles-recipe-box`. It uses
`PLATFORM_PROJECT` and `KC_BOOTSTRAP_ADMIN_*` from the `.env` the last deploy
wrote. Re-running it does nothing.

**4. Deploy the new images straight away:**

```bash
env -i HOME="$HOME" PATH="$PATH" SSM_PREFIX=/webapp/recipe-box/ IMAGE_TAG=<sha> deploy/scripts/deploy.sh
```

**5. Check:** sign in at https://www.specialbrew.net/recipe-box/ with a
password and with Google, open a recipe, and (as admin) the Approvals page.

No SSM parameter holds the realm name (the issuer is built from `AUTH_HOST` in
`deploy/docker-compose.prod.yml`). If `/webapp/recipe-box/KEYCLOAK_REALM`
exists anyway, set it to `recipe-box` before step 4.

**Rollback:** `deploy/keycloak/configure.sh` has no reverse command; in the
admin console (https://auth.specialbrew.net/admin, realm recipe-box > Realm
settings > General) set the name back to `app`, then deploy the previous
image tag.

## Local dev

Before restarting Keycloak (a restart with the new realm.json and no
"recipe-box" realm would import a fresh demo realm next to "app"):

```powershell
git pull
bash deploy/keycloak/configure.sh rename-realm
```

Then in `.env` change `/realms/app` to `/realms/recipe-box` in `OIDC_ISSUER`
and `OIDC_JWKS_URL`, and restart: `./dev.ps1 rails`, `./dev.ps1 api`,
`./dev.ps1 web`. (Or start over with an empty Keycloak: the demo users come
back from realm.json.)
