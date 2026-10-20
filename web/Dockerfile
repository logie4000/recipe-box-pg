# syntax=docker/dockerfile:1
# The production web build, packaged as an image so it ships through ECR with
# the APIs (.github/workflows/images.yml). Nothing runs from it:
# deploy/scripts/deploy.sh copies /site into the nginx web root.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# The npm that wrote package-lock.json (package.json "packageManager"), as in CI:
# Node 22's npm 10 rejects npm 11 lockfiles.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"  && npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

FROM busybox:stable
COPY --from=build /src/dist/web/browser /site
CMD ["true"]
