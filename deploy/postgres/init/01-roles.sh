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
#   keycloak      owns the keycloak database.
#
# app_reader and app_writer (and all grants) come from the first Rails
# migration: write-api/db/migrate/20260929160001_create_app_roles.rb.
# No `set -u`: the postgres entrypoint may source this file rather than exec it.
set -eo pipefail

: "${APP_DB_NAME:=app}"
: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_PLATFORM_PASSWORD:?APP_PLATFORM_PASSWORD is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v app_db="$APP_DB_NAME" \
  -v owner_pw="$APP_OWNER_PASSWORD" \
  -v platform_pw="$APP_PLATFORM_PASSWORD" \
  -v keycloak_pw="$KEYCLOAK_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE app_owner LOGIN CREATEROLE CREATEDB'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_owner') \gexec
ALTER ROLE app_owner PASSWORD :'owner_pw';

SELECT 'CREATE ROLE app_platform LOGIN BYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_platform') \gexec
ALTER ROLE app_platform PASSWORD :'platform_pw';

SELECT 'CREATE ROLE keycloak LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak') \gexec
ALTER ROLE keycloak PASSWORD :'keycloak_pw';

SELECT format('CREATE DATABASE %I OWNER app_owner', :'app_db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db') \gexec

SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak') \gexec
SQL

echo "01-roles.sh: app_owner, app_platform, keycloak roles and databases ready"
