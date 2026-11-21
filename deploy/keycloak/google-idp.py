#!/usr/bin/env python3
"""Prints the realm's "google" identity provider, turned on with the client
id and secret from KC_GOOGLE_CLIENT_ID / KC_GOOGLE_CLIENT_SECRET.

Reads the current provider (kcadm get identity-provider/instances/google) on
stdin, or nothing to start from realm.json's. Used by
deploy/scripts/shared-platform.sh; the secret goes through stdin, never a
command line.
"""
import json
import os
import pathlib
import sys

FLOW = "first broker login - link by email"

current = sys.stdin.read().strip()
if current:
    idp = json.loads(current)
else:
    realm = pathlib.Path(__file__).with_name("realm.json").read_text()
    realm = json.loads(realm.replace("${", "$_{"))  # placeholders are replaced below
    idp = next(p for p in realm["identityProviders"] if p["alias"] == "google")

idp["enabled"] = True
# Google verifies emails, so a Google sign-in links to an existing account
# with the same email instead of asking (FLOW, set up by shared-platform.sh).
idp["trustEmail"] = True
idp["firstBrokerLoginFlowAlias"] = FLOW
idp.setdefault("config", {}).update(
    clientId=os.environ["KC_GOOGLE_CLIENT_ID"],
    clientSecret=os.environ["KC_GOOGLE_CLIENT_SECRET"],
)
json.dump(idp, sys.stdout)
