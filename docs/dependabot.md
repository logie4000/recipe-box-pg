# Dependabot

Dependabot checks every Monday for updates to Ruby gems (write-api), Go
modules (server), npm packages (web), Docker base images and GitHub Actions
(`.github/dependabot.yml`). It waits 3 days after a release before proposing it.

Patch and minor updates arrive as one grouped PR per ecosystem. The
`Dependabot auto-merge` workflow turns on auto-merge (squash) for those, so
GitHub merges them by itself once CI is green. Major updates get their own PRs
and wait for you.

| Ecosystem | Patch/minor PRs |
|---|---|
| bundler, gomod, npm | merge on green CI with no review (their manifests and lockfiles have no code owner) |
| docker, github-actions | auto-merge is on, but they still wait for your code-owner review, because CI doesn't build the images or exercise the workflows |

## One-time repository settings

These can't be set from a PR:

1. **Settings > General > Pull Requests: tick "Allow auto-merge".** Without it
   the workflow's `gh pr merge --auto` fails.
2. **Settings > Rules > Rulesets > "Protect default branch": add "Require status
   checks to pass"** with these three checks (they appear once CI has run):
   - `write-api (RSpec, RuboCop, schema)`
   - `read-api (go vet/test, sqlc diff)`
   - `web (ng lint/test/build)`

   Without required checks, auto-merge merges a Dependabot PR immediately, before
   CI finishes. Your bypass on the ruleset is unchanged.

## Things to know

- A merge made by auto-merge here is pushed by `github-actions`, and GitHub does
  not start workflows from that push, so CI on main and the Images workflow don't
  run for it. The next ordinary push to main builds images that include the
  updates.
- Dependabot can't follow images pinned through `ARG` (ruby, keycloak, postgres)
  or the `${VAR}` images in `deploy/docker-compose*.yml`, nor Ruby
  (`.ruby-version`) and the Go version in `server/go.mod`. Bump those by hand.
- To stop an auto-merge, comment `@dependabot ignore this ...` or disable
  auto-merge on the PR.
