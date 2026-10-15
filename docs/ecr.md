# Production images in ECR

`.github/workflows/images.yml` builds the four production images (write-api,
read-api, keycloak, backup) and pushes them to Amazon ECR, tagged with the
commit SHA and `latest`. It runs after CI passes on `main`, or by hand from
the Actions tab (Images > Run workflow). The server pulls them in
`deploy/scripts/deploy.sh`.

GitHub signs in to AWS with a short-lived OIDC token, so no AWS keys are
stored in GitHub. The repositories are `<COMPOSE_PROJECT_NAME>-write-api` and
so on, created by the workflow the first time.

## One-time AWS setup

Replace `123456789012` with your account ID and `us-east-1` with your region.

1. **Let AWS trust GitHub.** IAM > Identity providers > Add provider:
   OpenID Connect, provider URL `https://token.actions.githubusercontent.com`,
   audience `sts.amazonaws.com`. Skip this if it's already listed.

2. **Create the role GitHub assumes.** IAM > Roles > Create role > Custom
   trust policy, named e.g. `recipe-box-github`. Only workflows on `main` of
   this repository can use it:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": {
           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
           "token.actions.githubusercontent.com:sub": "repo:logie4000@34590917/recipe-box-pg@1403265498:ref:refs/heads/main"
         }
       }
     }]
   }
   ```

   The `sub` must match what GitHub sends exactly. This repository uses
   GitHub's immutable subject format, with the owner and repository IDs after
   the names (they survive renames). Check the prefix with
   `gh api repos/logie4000/recipe-box-pg/actions/oidc/customization/sub`
   (`sub_claim_prefix`); without the immutable format it is plain
   `repo:logie4000/recipe-box-pg`.

3. **Give it ECR access only.** On the role: Add permissions > Create inline
   policy > JSON:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
       {
         "Effect": "Allow",
         "Action": [
           "ecr:DescribeRepositories", "ecr:CreateRepository",
           "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
           "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"
         ],
         "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/recipe-box-*"
       }
     ]
   }
   ```

4. **Tell the workflow where to push.** In GitHub: Settings > Secrets and
   variables > Actions > Variables, add `AWS_ROLE_ARN` (the role's ARN),
   `AWS_REGION` and `COMPOSE_PROJECT_NAME` (`recipe-box`, the same as in SSM).
   Or with the GitHub CLI:

   ```bash
   gh variable set AWS_ROLE_ARN --repo logie4000/recipe-box-pg --body arn:aws:iam::123456789012:role/recipe-box-github
   ```
   ```bash
   gh variable set AWS_REGION --repo logie4000/recipe-box-pg --body us-east-1
   ```
   ```bash
   gh variable set COMPOSE_PROJECT_NAME --repo logie4000/recipe-box-pg --body recipe-box
   ```

5. **The server side.** `ECR_REGISTRY` in SSM is
   `123456789012.dkr.ecr.us-east-1.amazonaws.com`, and the EC2 instance role
   needs the managed policy `AmazonEC2ContainerRegistryReadOnly`.

## Building and deploying

Run Actions > Images > Run workflow (or merge to `main`). The run summary
lists the pushed tags. On the server:

```bash
IMAGE_TAG=<commit sha> deploy/scripts/deploy.sh
```

ECR keeps every pushed image. Add a lifecycle policy to each repository
(ECR > repository > Lifecycle policy) to expire untagged images and keep,
say, the last 20, so storage stays small.
