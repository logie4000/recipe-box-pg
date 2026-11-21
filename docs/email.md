# Sign-up email (Amazon SES)

A password sign-up confirms its email address with a six-digit code before
it gets in. The write-api emails the code on the account's first sign-in,
and the home page asks for it. The right code marks the email verified in
Keycloak and grants `reader`, so the new account can add recipes at once,
with no Approvals step. Google sign-ins skip all this: Google has already
verified the address, so the app lets them straight in.

Codes last 15 minutes and allow 5 tries. A new one can be sent once a
minute, 5 a day per account. Only an HMAC of the code is stored, bound to
the address it was sent to; it never appears in an API response or in the
read-api's Approvals list, and the `code` parameter is filtered from the log.

Mail goes out through SES's API as Denali's instance role, so there are no
SMTP credentials to keep. Until `MAIL_FROM` is set nothing is sent, and
password sign-ups wait for an admin on the Approvals page as before. An
admin can still approve (or decline) anyone who hasn't entered their code.

The flow is the same as Sweat Equity's, and so is the sender:
`no-reply@specialbrew.net`, with "Recipe Box" as the display name. Sweat
Equity's setup (docs/deploy-denali.md there, "Sign-up email") already
verified `specialbrew.net` in SES, took the account out of the sandbox and
let Denali's role send as that address, so Recipe Box only needs its own
`MAIL_FROM` (step 2). Step 1 checks that the shared pieces are in place. The
steps use account 470114120012 and `us-east-1`.

## 1. Check what Sweat Equity set up

From PowerShell, signed in to the account:

```powershell
aws sesv2 get-email-identity --region us-east-1 --email-identity specialbrew.net --query 'VerifiedForSendingStatus'   # true
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'                                            # true
```

And in IAM, one of the policies on Denali's role `teapothill-denali-access`
should have this statement (Sweat Equity's):

```json
{
  "Effect": "Allow",
  "Action": ["ses:SendEmail", "ses:SendRawEmail"],
  "Resource": "arn:aws:ses:us-east-1:470114120012:identity/*",
  "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@specialbrew.net" } }
}
```

All three in place: nothing to change, go to step 2. If one is missing,
follow Sweat Equity's "Sign-up email (Amazon SES)" steps for it; they cover
both apps, since the identity, the account and the role are shared. The
containers reach the role through IMDSv2, as they already do for the photo
bucket.

## 2. Put the sender in SSM

```powershell
aws ssm put-parameter --region us-east-1 --name /webapp/recipe-box/MAIL_FROM --type String --value 'Recipe Box <no-reply@specialbrew.net>' --overwrite
```

The display name has a space and angle brackets; that's fine, because
`env-from-ssm.sh` writes such values to `.env` in single quotes, which both
bash and docker compose read literally (the same as Sweat Equity's). Only a
single quote in the value is refused. The address itself must stay
`no-reply@specialbrew.net`, the one the role's condition allows.

## 3. Deploy

Deploy with an image built from this change (it adds the SES gem, the
mailer and a migration, which the deploy runs):

```bash
IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
```

## 4. Test

1. In a private window, open the site, **Sign in or sign up** >
   **Create an account** with a new address (a verified one if the account
   is still in the sandbox).
2. Back on the home page it says "One last step: confirm your email
   address" and the email arrives from "Recipe Box" <no-reply@specialbrew.net>
   with the subject "123456 is your Recipe Box code".
3. Enter the code and press **Confirm**: My Recipes and Saved unlock, and
   the account isn't on the Approvals page.

If the email doesn't come, the page says "Couldn't send the email" and the
write-api log has the reason:

```bash
docker compose -p recipe-box logs write-api | grep "verification email"
```

`AccessDenied` means the role's statement (step 1) is missing or
`MAIL_FROM` uses another address; "Email address is not verified" means the
identity isn't verified or, in the sandbox, the recipient isn't. SES > Account
dashboard shows sends, bounces and complaints. SES's account-level
suppression list (on by default) stops mail to addresses that bounced or
complained.

## Turning it off

Delete the parameter and deploy: password sign-ups wait for an admin again.

```powershell
aws ssm delete-parameter --region us-east-1 --name /webapp/recipe-box/MAIL_FROM
```

## Local development

`make rails` (or `./dev.ps1 rails`) runs the write-api in development, which
writes each email to `write-api/tmp/mails/<address>` (and the log) instead
of sending it. Set `MAIL_FROM` in `.env` to any address, for example
`MAIL_FROM=Recipe Box <no-reply@recipe-box.localhost>`, restart it, and sign
up with a password: the code is in that file. With `MAIL_FROM` empty,
sign-ups wait for approval, as in production without SES. The compose
write-api (`--profile apps`) runs in production mode and would try SES.
