#!/usr/bin/env bash
# Renders the site config to stdout and installs the proxy snippet.
#   sudo APP_DOMAIN=example.com APP_NAME=myapp deploy/nginx/render.sh > /etc/nginx/sites-available/myapp.conf
#   sudo ln -s /etc/nginx/sites-available/myapp.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
set -euo pipefail
: "${APP_DOMAIN:?}" "${APP_NAME:?}"
here="$(cd "$(dirname "$0")" && pwd)"
snippets="${NGINX_SNIPPETS_DIR:-/etc/nginx/snippets}"
if [ -w "$snippets" ]; then
  cp "$here/proxy.conf" "$snippets/${APP_NAME}-proxy.conf"
else
  echo "note: copy $here/proxy.conf to $snippets/${APP_NAME}-proxy.conf" >&2
fi
envsubst '${APP_DOMAIN} ${APP_NAME}' < "$here/app.conf.template"
