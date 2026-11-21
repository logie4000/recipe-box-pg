# Email: verification and password reset (Amazon SES)

Keycloak sends two kinds of mail for Recipe Box: the "verify your email"
link after a password sign-up, and the "Forgot password?" reset link. In
production it sends them through Amazon SES (account 470114120012,
us-east-1) over SMTP. Locally they go to Mailpit.

The realm only turns on email verification together with a mail server.
Verification without one would mean nobody could finish signing up.

## What changes for users

- **New password sign-ups** get an email with a link and must click it before
  they can sign in. The sign-in page says "Check your email" and can send the
  link again. The app then approves them by itself, because their email is
  verified.
- **Existing password accounts whose email isn't verified** get the same
  email the next time they sign in, and must click the link to continue.
  Check that the admin account's email address is real (or mark it verified
  in the admin console: Users > the user > Email verified) before you turn
  this on.
- **Google sign-ins** don't change. Google has already verified the address.
- **"Forgot password?"** appears on the sign-in page and emails a reset link.

## How it's applied

On Denali, `deploy/scripts/shared-platform.sh` runs on every deploy. While
`KC_SMTP_HOST` is set in SSM it:

1. sets the recipe-box realm's mail server (Realm settings > Email) from the
   `KC_SMTP_*` parameters,
2. turns on **Verify email** and **Forgot password** (Realm settings > Login).

It only touches the recipe-box realm. With no `KC_SMTP_HOST` it changes
nothing and prints `no KC_SMTP_HOST, ... left as they are`. Removing the
parameter later doesn't turn email off (see "Turning it off").

| Parameter | Value |
| --- | --- |
| `KC_SMTP_HOST` | `email-smtp.us-east-1.amazonaws.com` |
| `KC_SMTP_PORT` | `587` (the default; STARTTLS) |
| `KC_SMTP_USER` | SES SMTP user name (step 3) |
| `KC_SMTP_PASSWORD` | SES SMTP password (step 3), **SecureString** |
| `KC_SMTP_FROM` | `no-reply@specialbrewsoftware.com` (any address on the domain verified in step 1) |
| `KC_SMTP_FROM_NAME` | optional, default `Recipe Box` |
| `KC_SMTP_REPLY_TO` | optional, where replies go (no-reply has no inbox): `info@specialbrewsoftware.com`, the privacy policy contact |
| `KC_SMTP_SSL` | optional: `true` for SSL from the start on port 465 instead of STARTTLS |

Don't put a value with spaces in SSM (such as a different
`KC_SMTP_FROM_NAME`): the deploy loads `.env` with bash, which reads
`KEY=two words` as a command. The default "Recipe Box" is set by the helper,
not by `.env`, so leave `KC_SMTP_FROM_NAME` out.

## 1. Verify the sender domain (with DKIM)

SES console (region **US East (N. Virginia)**) > **Identities** >
**Create identity** > **Domain**: enter the domain the mail comes from,
`specialbrewsoftware.com`. Leave **Easy DKIM** on, RSA 2048 bit, and **Publish DNS
records to Route 53** checked if the domain is in Route 53 in this account.

Otherwise SES shows three CNAME records to add at your DNS host:

```
<token1>._domainkey.specialbrewsoftware.com  CNAME  <token1>.dkim.amazonses.com
<token2>._domainkey.specialbrewsoftware.com  CNAME  <token2>.dkim.amazonses.com
<token3>._domainkey.specialbrewsoftware.com  CNAME  <token3>.dkim.amazonses.com
```

The identity turns **Verified** once SES sees them (minutes to a few hours).
Any address on the domain can then be the sender, so there's no mailbox to
create for `no-reply@`.

Also add, if the domain doesn't have them yet:

- **SPF**: nothing to do for a start. SES sends with its own envelope
  sender (an amazonses.com address), which passes SPF, and DKIM is what lines
  the mail up with specialbrewsoftware.com for DMARC. Optionally, give the identity a
  custom MAIL FROM domain (identity > **Custom MAIL FROM domain**, e.g.
  `mail.specialbrewsoftware.com`) and add the MX and TXT
  (`v=spf1 include:amazonses.com ~all`) records SES shows, so SPF aligns too.
- **DMARC**: a TXT record `_dmarc.specialbrewsoftware.com` with e.g.
  `v=DMARC1; p=none; rua=mailto:info@specialbrewsoftware.com`. Start with `p=none`, look at
  the reports, then tighten to `quarantine`.

## 2. Get out of the sandbox

A new SES account is in the **sandbox**: it can send only to addresses (or
domains) that are verified identities, 200 messages a day. To test before
production access, verify your own test addresses: **Identities** >
**Create identity** > **Email address**, then click the link SES sends.

For real sign-ups, request production access: SES console > **Account
dashboard** > **Request production access**. Mail type **Transactional**,
the website URL, and a short description such as: "Account emails for a
small recipe website: email address verification after sign-up and password
reset links, sent only to people who signed up. No marketing mail. Bounces
and complaints are handled by SES's suppression list." AWS usually answers
within a day.

## 3. Create SMTP credentials

SES console > **SMTP settings** > **Create SMTP credentials**. It creates an
IAM user (name it e.g. `ses-smtp-recipe-box`) allowed to send
(`ses:SendRawEmail`) and shows the **SMTP user name** and **SMTP password**
once. Download them; the password can't be shown again. The SMTP endpoint on
that page is `email-smtp.us-east-1.amazonaws.com`, port 587 (STARTTLS).

The console's user may send from any identity. To narrow it, replace its
inline policy in IAM with:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendRawEmail",
    "Resource": "arn:aws:ses:us-east-1:470114120012:identity/specialbrewsoftware.com"
  }]
}
```

<details>
<summary>Doing it by hand instead (IAM user + derived password)</summary>

Create an IAM user with the policy above and an access key. The SMTP user
name is the access key id. The SMTP password is derived from the secret
access key (it is not the secret itself). In PowerShell:

```powershell
$secret = Read-Host "Secret access key" -MaskInput
function Sign([byte[]]$key, [string]$msg) {
  [System.Security.Cryptography.HMACSHA256]::new($key).ComputeHash([Text.Encoding]::UTF8.GetBytes($msg))
}
$k = [Text.Encoding]::UTF8.GetBytes("AWS4" + $secret)
foreach ($m in '11111111', 'us-east-1', 'ses', 'aws4_request', 'SendRawEmail') { $k = Sign $k $m }
[Convert]::ToBase64String([byte[]](@(4) + $k))   # the SMTP password
```

</details>

## 4. Put the settings in SSM

From your Windows machine (Denali's instance role can only read SSM), in
PowerShell, signed in to account 470114120012:

```powershell
$p = '/webapp/recipe-box'
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_HOST" --type String --value 'email-smtp.us-east-1.amazonaws.com' --overwrite
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_PORT" --type String --value '587' --overwrite
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_FROM" --type String --value 'no-reply@specialbrewsoftware.com' --overwrite
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_USER" --type String --value '<SMTP user name>' --overwrite
$smtpPassword = Read-Host "SES SMTP password" -MaskInput
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_PASSWORD" --type SecureString --value $smtpPassword --overwrite
Remove-Variable smtpPassword
```

So replies reach a person (optional):

```powershell
aws ssm put-parameter --region us-east-1 --name "$p/KC_SMTP_REPLY_TO" --type String --value 'info@specialbrewsoftware.com' --overwrite
```

Check (names only):

```powershell
aws ssm get-parameters-by-path --region us-east-1 --path /webapp/recipe-box/ --query "Parameters[?contains(Name, 'KC_SMTP')].Name"
```

`Read-Host -MaskInput` needs PowerShell 7; in Windows PowerShell 5.1 leave
out `-MaskInput` (the password is then shown while you type).

## 5. Deploy

Deploy as usual (any image tag; nothing in the images changes):

```bash
IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
```

Look for this line in the output:

```
keycloak: email on for realm recipe-box via email-smtp.us-east-1.amazonaws.com (verify email, forgot password)
```

The first deploy with this change also installs the sign-in theme's new
messages ("Check your email", "Forgot password?"), which restarts the shared
Keycloak once (about half a minute in which no site on it can sign in).
Changing a parameter later only needs another deploy.

## 6. Test

1. In the admin console (https://auth.specialbrew.net/admin, realm
   recipe-box) > **Realm settings** > **Email**, check the settings, then
   **Test connection**. It sends to the signed-in admin's own address, so
   that address must be verified in SES while in the sandbox.
2. In a private window, open the site, **Sign in** > **Create an account**
   with a new address (a verified one while in the sandbox). The page says
   **Check your email**.
3. Open the "Verify email" mail and click the link. In the same browser
   that takes you on into the site; elsewhere it says the address is verified
   and you sign in. The app has approved you (no Approvals step): you can add
   a recipe.
4. Sign out, then **Sign in** > **Forgot password?** with the same address,
   and follow the reset link.

If no mail comes: Keycloak's log (`docker logs <infra-core keycloak
container>`) shows the SMTP error; "Email address is not verified" means
the account is still in the sandbox and the recipient isn't verified; SES >
**Account dashboard** shows sends, bounces and complaints.

## Turning it off

Deleting `KC_SMTP_HOST` stops deploys from re-applying the settings but
leaves them in the realm. To turn verification off, in the admin console >
Realm settings > **Login**, switch off **Verify email** (and **Forgot
password** if mail won't work any more), then delete the `KC_SMTP_*`
parameters.

## Local development

`make up` also starts Mailpit, which catches every mail Keycloak sends:
http://127.0.0.1:8025 (`./dev.ps1 up` starts it too).
`.env.example` points `KC_SMTP_*` at it (`KC_SMTP_HOST=mailpit`, port 1025);
copy those lines into an older `.env`. Then turn it on in the local realm
once (it stays across restarts):

```bash
bash deploy/keycloak/configure.sh email
```

A fresh realm import (an empty Keycloak) starts without email again, like
production before `KC_SMTP_HOST` is set; run the command again. The demo
users are already verified. Sign up with any address, then open the mail in
Mailpit.

`configure.sh email` works the same against a standalone production
Keycloak (with the SES values in that host's `.env`), or against the shared
one with `PLATFORM_PROJECT` in `.env`. It needs Python 3 on the machine that
runs it.
