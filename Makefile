# Developer entry points. Needs GNU make + bash: on Windows run it from Git
# Bash (or WSL). PowerShell users: ./dev.ps1 <target> does the same things.
#
#   make env      create .env from .env.example
#   make up       postgres + keycloak (docker compose), realm auto-imported
#   make migrate  rails db:migrate db:seed (as app_owner), then sqlc generate
#   make rails    write-api on :3000       make api   read-api on :8080
#   make web      ng serve on :4200 (/api/v1: GET -> :8080, writes -> :3000; /admin -> :3000)
#   make test     rspec + go test + ng test
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

ifneq (,$(wildcard .env))
include .env
export
endif

COMPOSE := docker compose -f deploy/docker-compose.yml $(if $(wildcard .env),--env-file .env,)
COMPOSE_PROD := $(COMPOSE) -f deploy/docker-compose.prod.yml
SQLC_VERSION := 1.30.0
RUBY := ruby
# Git Bash would rewrite /src-style paths passed to docker.
export MSYS_NO_PATHCONV := 1
REPO_DIR := $(shell pwd -W 2>/dev/null || pwd)

.PHONY: help env up down logs psql migrate rollback seed gen rails api web \
        test test-rails test-go test-web lint check-queries verify-roles build \
        restore-drill reset-db

help: ## list targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

env: ## create .env from .env.example (keeps an existing .env)
	@if [ -f .env ]; then echo ".env exists, leaving it alone"; else cp .env.example .env && echo "created .env"; fi

up: ## start postgres + keycloak and wait until healthy
	$(COMPOSE) up -d --wait postgres keycloak
	@echo "Keycloak: http://localhost:$${KEYCLOAK_PORT:-8081} (admin console: /admin)"

down: ## stop containers (data volume kept)
	$(COMPOSE) --profile apps down

logs: ## follow container logs
	$(COMPOSE) logs -f

psql: ## psql into the app database as app_owner
	$(COMPOSE) exec -e PGPASSWORD="$${APP_OWNER_PASSWORD}" postgres psql -h localhost -U app_owner -d "$${APP_DB_NAME:-app}"

migrate: ## run Rails migrations + seeds (app_owner), then regenerate sqlc code
	cd write-api && $(RUBY) bin/rails db:migrate && $(RUBY) bin/rails db:seed
	$(MAKE) gen

rollback: ## roll back the last migration
	cd write-api && $(RUBY) bin/rails db:rollback
	$(MAKE) gen

seed: ## re-run db/seeds.rb
	cd write-api && $(RUBY) bin/rails db:seed

gen: ## sqlc generate (local sqlc if installed, else the sqlc docker image)
	@if command -v sqlc >/dev/null 2>&1; then \
	  cd server && sqlc generate; \
	else \
	  docker run --rm -v "$(REPO_DIR):/src" -w /src/server sqlc/sqlc:$(SQLC_VERSION) generate; \
	fi
	@echo "sqlc: server/internal/db/sqlc regenerated"

rails: ## write-api on http://localhost:3000
	cd write-api && $(RUBY) bin/rails server -p $${WRITE_API_PORT:-3000}

api: ## read-api on http://localhost:8080
	cd server && go run ./cmd/read-api

web: ## Angular dev server on http://localhost:4200
	cd web && npm start

test: test-rails test-go test-web ## all test suites

test-rails: ## RSpec (needs `make up`)
	cd write-api && RAILS_ENV=test $(RUBY) bin/rails db:create 2>/dev/null || true
	cd write-api && bundle exec rspec

test-go: ## go vet + go test (DB test uses testcontainers; skipped without Docker)
	cd server && go vet ./... && go test ./...

test-web: ## Angular unit tests (vitest)
	cd web && npx ng test --watch=false

lint: check-queries ## rubocop, gofmt/vet, ng lint
	cd write-api && bundle exec rubocop
	cd server && test -z "$$(gofmt -l .)" && go vet ./...
	cd web && npx ng lint

check-queries: ## fail if server/queries contains anything but SELECTs
	@if grep -niE '^[^-]*\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy)\b' server/queries/*.sql; then \
	  echo "read-api queries must be SELECT only"; exit 1; fi
	@echo "server/queries: SELECT only"

verify-roles: ## check reader can't write and writer can't change the schema
	bash deploy/postgres/verify-roles.sh

build: ## build the three deployables
	cd web && npx ng build
	cd server && CGO_ENABLED=0 go build -o bin/read-api ./cmd/read-api
	$(COMPOSE) --profile apps build write-api read-api

restore-drill: ## restore the newest S3 dump into a scratch container and check it
	bash deploy/scripts/restore-drill.sh

reset-db: ## DANGER: delete the local postgres volume and start over
	@read -r -p "Delete the local database volume? [y/N] " ans && [ "$$ans" = y ]
	$(COMPOSE) --profile apps down -v
