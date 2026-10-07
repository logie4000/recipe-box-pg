#!/usr/bin/env bash
# Renders the site config to stdout and installs the proxy snippet.
#   sudo APP_DOMAIN=example.com APP_NAME=myapp deploy/nginx/render.sh > /etc/nginx/sites-available/myapp.conf
# APP_HOST and AUTH_HOST default to app.$APP_DOMAIN and auth.$APP_DOMAIN.
#   sudo ln -s /etc/nginx/sites-available/myapp.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
set -euo pipefail
: "${APP_DOMAIN:?}" "${APP_NAME:?}"
export APP_HOST="${APP_HOST:-app.$APP_DOMAIN}" AUTH_HOST="${AUTH_HOST:-auth.$APP_DOMAIN}"
here="$(cd "$(dirname "$0")" && pwd)"
snippets="${NGINX_SNIPPETS_DIR:-/etc/nginx/snippets}"
if [ -w "$snippets" ]; then
  cp "$here/proxy.conf" "$snippets/${APP_NAME}-proxy.conf"
else
  echo "note: copy $here/proxy.conf to $snippets/${APP_NAME}-proxy.conf" >&2
fi
envsubst '${APP_DOMAIN} ${APP_NAME} ${APP_HOST} ${AUTH_HOST}' < "$here/app.conf.template"
