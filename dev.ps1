<#
.SYNOPSIS
  PowerShell equivalent of the Makefile for Windows without Git Bash.

.EXAMPLE
  ./dev.ps1 env        # create .env from .env.example
  ./dev.ps1 up         # postgres + keycloak
  ./dev.ps1 migrate    # rails db:migrate db:seed, then sqlc generate
  ./dev.ps1 rails      # write-api :3000   (separate terminal)
  ./dev.ps1 api        # read-api  :8080   (separate terminal)
  ./dev.ps1 web        # ng serve  :4200   (separate terminal)
  ./dev.ps1 test
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('help', 'env', 'up', 'down', 'logs', 'psql', 'migrate', 'rollback', 'seed', 'gen', 'rails', 'api', 'web',
    'test', 'test-rails', 'test-go', 'test-web', 'lint', 'check-queries', 'verify-roles', 'build')]
  [string]$Task = 'help'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$SqlcVersion = '1.30.0'

# Load .env into this process (real environment variables win).
$EnvFile = Join-Path $Root '.env'
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $name = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name)) { [Environment]::SetEnvironmentVariable($name, $value) }
    }
  }
}

function Compose {
  $composeArgs = @('compose', '-f', (Join-Path $Root 'deploy/docker-compose.yml'))
  if (Test-Path $EnvFile) { $composeArgs += @('--env-file', $EnvFile) }
  & docker @composeArgs @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $args failed" }
}

function In-Dir([string]$Dir, [scriptblock]$Block) {
  Push-Location (Join-Path $Root $Dir)
  try { & $Block; if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "command failed in $Dir" } } finally { Pop-Location }
}

function Gen {
  if (Get-Command sqlc -ErrorAction SilentlyContinue) {
    In-Dir 'server' { sqlc generate }
  } else {
    & docker run --rm -v "${Root}:/src" -w /src/server "sqlc/sqlc:$SqlcVersion" generate
    if ($LASTEXITCODE -ne 0) { throw 'sqlc generate failed' }
  }
  Write-Host 'sqlc: server/internal/db/sqlc regenerated'
}

function Check-Queries {
  $bad = Select-String -Path (Join-Path $Root 'server/queries/*.sql') `
    -Pattern '^[^-]*\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy)\b'
  if ($bad) { $bad | ForEach-Object { Write-Host $_ }; throw 'read-api queries must be SELECT only' }
  Write-Host 'server/queries: SELECT only'
}

switch ($Task) {
  'help' { Get-Help $PSCommandPath -Examples }
  'env' {
    if (Test-Path $EnvFile) { Write-Host '.env exists, leaving it alone' }
    else { Copy-Item (Join-Path $Root '.env.example') $EnvFile; Write-Host 'created .env' }
  }
  'up' { Compose up -d --wait postgres keycloak; Write-Host "Keycloak: http://localhost:$(if ($env:KEYCLOAK_PORT) { $env:KEYCLOAK_PORT } else { 8081 })" }
  'down' { Compose --profile apps down }
  'logs' { Compose logs -f }
  'psql' { Compose exec -e "PGPASSWORD=$env:APP_OWNER_PASSWORD" postgres psql -h localhost -U app_owner -d $env:APP_DB_NAME }
  'migrate' { In-Dir 'write-api' { ruby bin/rails db:migrate; ruby bin/rails db:seed }; Gen }
  'rollback' { In-Dir 'write-api' { ruby bin/rails db:rollback }; Gen }
  'seed' { In-Dir 'write-api' { ruby bin/rails db:seed } }
  'gen' { Gen }
  'rails' { In-Dir 'write-api' { ruby bin/rails server -p 3000 } }
  'api' { In-Dir 'server' { go run ./cmd/read-api } }
  'web' { In-Dir 'web' { npm start } }
  'test-rails' { In-Dir 'write-api' { $env:RAILS_ENV = 'test'; ruby bin/rails db:create; Remove-Item Env:RAILS_ENV; bundle exec rspec } }
  'test-go' { In-Dir 'server' { go vet ./...; go test ./... } }
  'test-web' { In-Dir 'web' { npx ng test --watch=false } }
  'test' { & $PSCommandPath test-rails; & $PSCommandPath test-go; & $PSCommandPath test-web }
  'check-queries' { Check-Queries }
  'lint' {
    Check-Queries
    In-Dir 'write-api' { bundle exec rubocop }
    In-Dir 'server' { $unformatted = gofmt -l .; if ($unformatted) { throw "gofmt: $unformatted" }; go vet ./... }
    In-Dir 'web' { npx ng lint }
  }
  'verify-roles' { & bash (Join-Path $Root 'deploy/postgres/verify-roles.sh') }
  'build' {
    In-Dir 'web' { npx ng build }
    In-Dir 'server' { $env:CGO_ENABLED = '0'; go build -o bin/read-api.exe ./cmd/read-api }
    Compose --profile apps build write-api read-api
  }
}
