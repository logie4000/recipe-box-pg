#!/usr/bin/env python3
"""Prints deploy/keycloak/realm.json ready for the admin API.

Keycloak fills ${VAR} / ${VAR:default} placeholders itself when it imports
the file at startup (--import-realm). A realm added to a Keycloak that is
already running (a shared one, deploy/scripts/shared-platform.sh) goes in
through the admin API, which doesn't, so this fills them from the
environment the same way. It also drops the demo users and organizations
(alice/alice and friends) unless KEEP_DEMO_USERS=1; the rails-admin
service account stays.

    python3 deploy/keycloak/render-realm.py > realm.rendered.json
"""
import json
import os
import pathlib
import re
import sys

source = pathlib.Path(__file__).with_name("realm.json").read_text()
missing = set()


def fill(match):
    name, default = match.group(1), match.group(3)
    value = os.environ.get(name, "")
    if value:
        return json.dumps(value)[1:-1]
    if default is not None:
        return default
    missing.add(name)
    return ""


rendered = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:([^}]*))?\}", fill, source)
if missing:
    sys.exit(f"render-realm: set {', '.join(sorted(missing))}")

realm = json.loads(rendered)
if os.environ.get("KEEP_DEMO_USERS") != "1":
    # Keep the rails-admin service account (sign-up approvals need it).
    realm["users"] = [u for u in realm.get("users", []) if u.get("serviceAccountClientId")]
    realm.pop("organizations", None)
json.dump(realm, sys.stdout, indent=2)
print()
