#!/usr/bin/env bash
# Runs once, as the Postgres superuser, when the data directory is empty
# (docker-entrypoint-initdb.d). CI runs it directly against its service
# container. Creates what an unprivileged migration cannot:
#
#   app_owner     LOGIN CREATEROLE CREATEDB; owns the app database and every
#                 table (Rails migrations). CREATEDB is for the test database.
#                 Deliberately NOT BYPASSRLS: FORCE RLS applies to it too.
#   app_platform  LOGIN BYPASSRLS; platform/maintenance tasks only. Only a
#                 superuser may grant BYPASSRLS, so it is created here.
#   keycloak      owns the keycloak database (skipped when
#                 KEYCLOAK_DB_PASSWORD is unset, e.g. a shared Keycloak).
#
# Role names are cluster-wide, so a second app on the same Postgres server
# needs its own: APP_OWNER_USER / APP_PLATFORM_USER (and APP_READER_USER /
# APP_WRITER_USER for lib/db_roles.rb) override the defaults.
#
# app_reader and app_writer (and all grants) come from the first Rails
# migration: write-api/db/migrate/20260929160001_create_app_roles.rb.
# No `set -u`: the postgres entrypoint may source this file rather than exec it.
set -eo pipefail

: "${APP_DB_NAME:=app}"
: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_PLATFORM_PASSWORD:?APP_PLATFORM_PASSWORD is required}"
: "${APP_OWNER_USER:=app_owner}"
: "${APP_PLATFORM_USER:=app_platform}"
: "${KEYCLOAK_DB_USER:=keycloak}"
: "${KEYCLOAK_DB_NAME:=keycloak}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v app_db="$APP_DB_NAME" \
  -v owner="$APP_OWNER_USER" \
  -v owner_pw="$APP_OWNER_PASSWORD" \
  -v platform="$APP_PLATFORM_USER" \
  -v platform_pw="$APP_PLATFORM_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEROLE CREATEDB', :'owner')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'owner', :'owner_pw') \gexec

SELECT format('CREATE ROLE %I LOGIN BYPASSRLS', :'platform')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'platform') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'platform', :'platform_pw') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'owner')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db') \gexec
SQL

if [ -n "${KEYCLOAK_DB_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
    -v kc="$KEYCLOAK_DB_USER" \
    -v kc_db="$KEYCLOAK_DB_NAME" \
    -v kc_pw="$KEYCLOAK_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'kc')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'kc') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'kc', :'kc_pw') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'kc_db', :'kc')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'kc_db') \gexec
SQL
fi

echo "01-roles.sh: $APP_OWNER_USER, $APP_PLATFORM_USER and database $APP_DB_NAME ready${KEYCLOAK_DB_PASSWORD:+ (plus $KEYCLOAK_DB_USER/$KEYCLOAK_DB_NAME)}"
