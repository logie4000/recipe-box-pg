#!/usr/bin/env bash
# Renders the site config to stdout and installs the two snippets it includes
# (proxy headers, and the app's locations) into $NGINX_SNIPPETS_DIR.
#
#   sudo APP_DOMAIN=example.com APP_NAME=myapp deploy/nginx/render.sh > /etc/nginx/conf.d/myapp.conf
#   sudo nginx -t && sudo systemctl reload nginx
#
# APP_HOST, AUTH_HOST  default app.$APP_DOMAIN and auth.$APP_DOMAIN
# APP_PATH             serve the app under a path, e.g. /recipe-box (default: the root)
# APP_SERVER=existing  APP_HOST is a site your nginx already serves: leave out
#                      our server block for it and add this line to yours:
#                        include /etc/nginx/snippets/<APP_NAME>-locations.conf;
# WEB_ROOT             nginx root for the Angular build; files must be at
#                      $WEB_ROOT$APP_PATH/ (default /srv/www, or
#                      /srv/www/$APP_NAME without APP_PATH)
set -euo pipefail
: "${APP_DOMAIN:?}" "${APP_NAME:?}"
APP_PATH="${APP_PATH%/}"
case "$APP_PATH" in ""|/*) ;; *) echo "APP_PATH must start with /" >&2; exit 2 ;; esac
export APP_NAME APP_PATH
export APP_HOST="${APP_HOST:-app.$APP_DOMAIN}" AUTH_HOST="${AUTH_HOST:-auth.$APP_DOMAIN}"
# nginx variable names can't contain "-" (APP_NAME=recipe-box).
export APP_ID="${APP_NAME//[^A-Za-z0-9_]/_}"
if [ -n "$APP_PATH" ]; then
  export WEB_ROOT="${WEB_ROOT:-/srv/www}"
  export APP_PATH_REDIRECT="location = $APP_PATH { return 301 $APP_PATH/\$is_args\$args; }"
else
  export WEB_ROOT="${WEB_ROOT:-/srv/www/$APP_NAME}"
  export APP_PATH_REDIRECT=""
fi
vars='${APP_DOMAIN} ${APP_NAME} ${APP_ID} ${APP_HOST} ${AUTH_HOST} ${APP_PATH} ${APP_PATH_REDIRECT} ${WEB_ROOT}'

here="$(cd "$(dirname "$0")" && pwd)"
snippets="${NGINX_SNIPPETS_DIR:-/etc/nginx/snippets}"
mkdir -p "$snippets" 2>/dev/null || true
if [ -w "$snippets" ]; then
  cp "$here/proxy.conf" "$snippets/${APP_NAME}-proxy.conf"
  envsubst "$vars" < "$here/locations.conf.template" > "$snippets/${APP_NAME}-locations.conf"
  echo "wrote $snippets/${APP_NAME}-proxy.conf and $snippets/${APP_NAME}-locations.conf" >&2
else
  echo "error: can't write $snippets (run with sudo)" >&2
  exit 1
fi

if [ "${APP_SERVER:-}" = existing ]; then
  sed '/^# --- app server/,/^# --- end app server ---/d' "$here/app.conf.template" | envsubst "$vars"
  echo "add to your ${APP_HOST} server block: include $snippets/${APP_NAME}-locations.conf;" >&2
else
  envsubst "$vars" < "$here/app.conf.template"
fi
