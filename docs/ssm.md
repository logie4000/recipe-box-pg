# Production settings in SSM Parameter Store

The production `.env` never lives in git or on a laptop. Every setting is a
parameter in AWS Systems Manager Parameter Store, and `deploy/scripts/deploy.sh`
rebuilds the server's `.env` from them on every deploy
(`deploy/scripts/env-from-ssm.sh`). Standard parameters are free.

Parameters live under one path, `/webapp/<COMPOSE_PROJECT_NAME>/` by default
(override with `SSM_PREFIX`). The last part of each name is the variable:
`/webapp/recipe-box/APP_DOMAIN` becomes `APP_DOMAIN=...`. Keys containing
`PASSWORD` or `SECRET` are `SecureString` (encrypted with the account's default
`aws/ssm` key); the rest are `String`.

## First-time setup

You need the AWS CLI v2 on your machine, signed in to the account
(`aws configure` or `aws sso login`) with permission to `ssm:PutParameter`.

1. **Fill in the settings.**

   ```bash
   cp .env.production.example .env.production
   ```

   `.env.production` is gitignored. Set the domain, region, ECR registry,
   backup and photo buckets, and replace every `CHANGE_ME` with a generated
   secret (a different one for each):

   ```bash
   openssl rand -hex 32
   ```

   Use `openssl rand -hex 64` for `SECRET_KEY_BASE`. Settings left out use
   the defaults in `deploy/docker-compose*.yml`; add any other key from
   `.env.example` to change one.

2. **Upload them.** Check first, then upload:

   ```bash
   DRY_RUN=1 deploy/scripts/env-to-ssm.sh .env.production
   ```
   ```bash
   deploy/scripts/env-to-ssm.sh .env.production
   ```

   It prints the path it used (e.g. `/webapp/recipe-box/`) and never the
   values. Empty values are skipped, since SSM doesn't allow them.

3. **Let the server read them.** Add to the EC2 instance role (with your
   region, account and path):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "ssm:GetParametersByPath",
       "Resource": [
         "arn:aws:ssm:us-east-1:123456789012:parameter/webapp/recipe-box",
         "arn:aws:ssm:us-east-1:123456789012:parameter/webapp/recipe-box/*"
       ]
     }]
   }
   ```

   The default `aws/ssm` key needs no extra KMS permission. If you encrypt
   with your own KMS key, also allow `kms:Decrypt` on it.

4. **First deploy.** Tell the server which path to read, once:

   ```bash
   SSM_PREFIX=/webapp/recipe-box/ IMAGE_TAG=<git sha> deploy/scripts/deploy.sh
   ```

   Later deploys find the path from `COMPOSE_PROJECT_NAME` in the `.env` the
   last deploy wrote. The deploy stops if the path has no parameters.

## Changing a setting

Edit `.env.production` and run `env-to-ssm.sh` again (it overwrites), or
change one value:

```bash
aws ssm put-parameter --name /webapp/recipe-box/RATE_LIMIT_UPLOADS_PER_MINUTE --type String --value 30 --overwrite
```

Then deploy, so the containers restart with the new `.env`. To remove a
setting: `aws ssm delete-parameter --name /webapp/recipe-box/<KEY>`.

To see what's stored (names only), or get the whole `.env` back on any
machine with access:

```bash
aws ssm get-parameters-by-path --path /webapp/recipe-box/ --query "Parameters[].Name"
```
```bash
SSM_PREFIX=/webapp/recipe-box/ deploy/scripts/env-from-ssm.sh
```

Parameter Store is the source of truth. Once uploaded, keep `.env.production`
in a password manager or delete it.

On Windows, run the scripts from Git Bash. When typing `aws ssm` commands
there yourself, prefix them with `MSYS_NO_PATHCONV=1` so `/webapp/...` isn't
turned into a Windows path.
