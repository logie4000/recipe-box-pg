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

The flow is the same as Sweat Equity's. The sender is
`no-reply@specialbrewsoftware.com`, which is a different SES identity from
Sweat Equity's `specialbrew.net`, so it needs verifying once (step 1). The
steps use account 470114120012 and `us-east-1`; use the same region as
`AWS_REGION` in SSM.

## 1. Verify the domain in SES (with DKIM)

Verifying `specialbrewsoftware.com` lets the app send from any address there
(no mailbox needed for `no-reply@`), and DKIM keeps the mail out of spam.
From PowerShell, signed in to the account:

```powershell
aws sesv2 create-email-identity --region us-east-1 --email-identity specialbrewsoftware.com
aws sesv2 get-email-identity --region us-east-1 --email-identity specialbrewsoftware.com --query 'DkimAttributes.Tokens' --output text
```

For each of the three tokens, add a DNS record:

```
<token>._domainkey.specialbrewsoftware.com  CNAME  <token>.dkim.amazonses.com
```

If the zone is in Route 53 in this account, the SES console (Identities,
then specialbrewsoftware.com) offers to add them for you. The identity shows
*Verified* once DNS has the records, usually within an hour:

```powershell
aws sesv2 get-email-identity --region us-east-1 --email-identity specialbrewsoftware.com --query 'VerifiedForSendingStatus'
```

If the domain has no DMARC record yet, add
`TXT _dmarc.specialbrewsoftware.com "v=DMARC1; p=none;"`. SPF needs nothing:
SES sends with its own envelope sender, and DKIM lines the mail up with the
domain for DMARC.

## 2. Production access (skip if already done)

Production access is per account and region, not per domain. Sweat Equity
already sends from this account in `us-east-1`, so it is most likely on;
check:

```powershell
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'
```

`true`: skip this step. `false`: the account is in the sandbox and can only
send to verified addresses, 200 a day. Ask for production access in the SES
console (Account dashboard, then Request production access: mail type
*Transactional*, the site's URL, and a line like "one-time sign-up codes for
a small recipe website; users ask for each email"). AWS usually answers
within a day. To test before then, verify the address you'll sign up with:
`aws sesv2 create-email-identity --region us-east-1 --email-identity you@example.com`
and click the link SES sends.

## 3. Let the instance role send

The write-api calls SES as Denali's instance role, `teapothill-denali-access`
(the same role that reads SSM and writes the photo bucket). In IAM, add
this statement to one of its policies:

```json
{
  "Effect": "Allow",
  "Action": ["ses:SendEmail", "ses:SendRawEmail"],
  "Resource": "arn:aws:ses:us-east-1:470114120012:identity/*",
  "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@specialbrewsoftware.com" } }
}
```

If the role already has Sweat Equity's statement (the same thing for
`no-reply@specialbrew.net`), add the new address to its condition instead:
`"ses:FromAddress": ["no-reply@specialbrew.net", "no-reply@specialbrewsoftware.com"]`.
The resource is `identity/*`, as for Sweat Equity, so the statement also
works while an account is in the sandbox (when SES can check permission on
the recipient's identity too); the condition is what limits the sender.

The containers reach the role through IMDSv2, as they already do for the
photo bucket, so nothing else changes on the instance.

## 4. Put the sender in SSM

From PowerShell:

```powershell
aws ssm put-parameter --region us-east-1 --name /webapp/recipe-box/MAIL_FROM --type String --value 'Recipe Box <no-reply@specialbrewsoftware.com>' --overwrite
```

The display name has a space and angle brackets; that's fine, because
`env-from-ssm.sh` writes such values to `.env` in single quotes, which both
bash and docker compose read literally (the same as Sweat Equity's). Only a
single quote in the value is refused. A plain
`no-reply@specialbrewsoftware.com` works too; the mail then shows just the
address as the sender.

## 5. Deploy

Deploy with an image built from this change (it adds the SES gem, the
mailer and a migration, which the deploy runs):

```bash
IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
```

## 6. Test

1. In a private window, open the site, **Sign in or sign up** >
   **Create an account** with a new address (a verified one if the account
   is still in the sandbox).
2. Back on the home page it says "One last step: confirm your email
   address" and the email arrives from no-reply@specialbrewsoftware.com
   with the subject "123456 is your Recipe Box code".
3. Enter the code and press **Confirm**: My Recipes and Saved unlock, and
   the account isn't on the Approvals page.

If the email doesn't come, the page says "Couldn't send the email" and the
write-api log has the reason:

```bash
docker compose -p recipe-box logs write-api | grep "verification email"
```

`AccessDenied` means the role's policy (step 3) is missing or names another
address; "Email address is not verified" means the identity isn't verified
yet (step 1) or, in the sandbox, the recipient isn't. SES > Account
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
