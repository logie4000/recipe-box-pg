#!/usr/bin/env python3
"""Prints the realm settings that turn on email: the SMTP server from
KC_SMTP_* plus verifyEmail and resetPasswordAllowed, as JSON for
`kcadm update realms/recipe-box -f -`.

    KC_SMTP_HOST        required (the caller only runs this when it is set)
    KC_SMTP_PORT        default 587 (465 with KC_SMTP_SSL=true)
    KC_SMTP_USER        SMTP user; with it, KC_SMTP_PASSWORD and auth on
    KC_SMTP_PASSWORD
    KC_SMTP_FROM        required, e.g. no-reply@example.com
    KC_SMTP_FROM_NAME   default "Recipe Box"
    KC_SMTP_REPLY_TO    optional
    KC_SMTP_SSL         true: SSL from the start (port 465) instead of STARTTLS

Used by deploy/scripts/shared-platform.sh and deploy/keycloak/configure.sh
email. Everything comes from the environment and leaves on stdout, so the
password is never on a command line.
"""
import json
import os
import sys


def env(name, default=""):
    return os.environ.get(name, "").strip() or default


host = env("KC_SMTP_HOST")
sender = env("KC_SMTP_FROM")
user = env("KC_SMTP_USER")
password = os.environ.get("KC_SMTP_PASSWORD", "")
ssl = env("KC_SMTP_SSL", "false").lower() == "true"

if not host or not sender:
    sys.exit("smtp-settings: set KC_SMTP_HOST and KC_SMTP_FROM")
if user and not password:
    sys.exit("smtp-settings: set KC_SMTP_PASSWORD with KC_SMTP_USER")

smtp = {
    "host": host,
    "port": env("KC_SMTP_PORT", "465" if ssl else "587"),
    "from": sender,
    "fromDisplayName": env("KC_SMTP_FROM_NAME", "Recipe Box"),
    "ssl": json.dumps(ssl),
    "starttls": json.dumps(not ssl),
    "auth": json.dumps(bool(user)),
}
if env("KC_SMTP_REPLY_TO"):
    smtp["replyTo"] = env("KC_SMTP_REPLY_TO")
if user:
    smtp.update(authType="basic", user=user, password=password)

json.dump(
    {
        "smtpServer": smtp,
        # Password sign-ups confirm their address before they can sign in
        # (only ever turned on together with a mail server, or nobody could).
        "verifyEmail": True,
        # Mail works, so "Forgot password?" can send the reset link.
        "resetPasswordAllowed": True,
    },
    sys.stdout,
)
