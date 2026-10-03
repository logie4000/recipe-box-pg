// Package config reads read-api settings from the environment. In local
// development the repo-root .env is loaded first (real env vars win), so the
// same file serves docker compose, Rails and this service.
package config

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Addr               string
	DatabaseURL        string
	DBMaxConns         int32
	OIDCIssuer         string
	OIDCAudience       string
	OIDCJWKSURL        string
	CORSAllowedOrigins []string
	TenantMode         bool
	TenantSubdomains   bool
	MinClientVersion   string
	AppVersion         string
	LogFormat          string // "json" (default) or "text"
	ImageStorage       string // "local" (default)
	ImageStorageDir    string
}

func Load() (Config, error) {
	loadDotEnv()

	issuer := env("OIDC_ISSUER", "http://localhost:8081/realms/app")
	c := Config{
		Addr:               env("READ_API_ADDR", ":8080"),
		DatabaseURL:        os.Getenv("READ_API_DATABASE_URL"),
		OIDCIssuer:         issuer,
		OIDCAudience:       env("OIDC_AUDIENCE", "app-api"),
		OIDCJWKSURL:        env("OIDC_JWKS_URL", issuer+"/protocol/openid-connect/certs"),
		CORSAllowedOrigins: splitList(env("CORS_ALLOWED_ORIGINS", "http://localhost:4200,capacitor://localhost,https://localhost")),
		TenantMode:         env("TENANT_MODE", "off") == "on",
		TenantSubdomains:   env("TENANT_SUBDOMAINS", "off") == "on",
		MinClientVersion:   env("MIN_SUPPORTED_CLIENT_VERSION", "0.0.0"),
		AppVersion:         env("APP_VERSION", "dev"),
		LogFormat:          env("LOG_FORMAT", "json"),
		ImageStorage:       env("IMAGE_STORAGE", "local"),
		// Same directory the write-api stores photos in. `make api` runs from
		// server/, so the dev default is <repo>/storage/images.
		ImageStorageDir: env("IMAGE_STORAGE_DIR", filepath.Join("..", "storage", "images")),
	}

	maxConns, err := strconv.Atoi(env("READ_API_DB_MAX_CONNS", "10"))
	if err != nil {
		return c, fmt.Errorf("READ_API_DB_MAX_CONNS: %w", err)
	}
	c.DBMaxConns = int32(maxConns)

	if c.DatabaseURL == "" {
		u := url.URL{
			Scheme:   "postgres",
			User:     url.UserPassword(env("APP_READER_USER", "app_reader"), os.Getenv("APP_READER_PASSWORD")),
			Host:     env("DB_HOST", "localhost") + ":" + env("DB_PORT", "5432"),
			Path:     "/" + env("APP_DB_NAME", "app"),
			RawQuery: "sslmode=" + env("DB_SSLMODE", "disable") + "&application_name=read-api",
		}
		c.DatabaseURL = u.String()
	}
	return c, nil
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// loadDotEnv loads the nearest .env walking up from the working directory
// (server/ -> repo root). Existing variables are never overwritten. Only
// simple KEY=VALUE lines are supported, like docker compose.
func loadDotEnv() {
	if os.Getenv("READ_API_SKIP_DOTENV") != "" {
		return
	}
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 3; i++ {
		if f, err := os.Open(filepath.Join(dir, ".env")); err == nil {
			defer f.Close()
			s := bufio.NewScanner(f)
			for s.Scan() {
				line := strings.TrimSpace(s.Text())
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				k, v, ok := strings.Cut(line, "=")
				if !ok {
					continue
				}
				k = strings.TrimSpace(strings.TrimPrefix(k, "export "))
				v = strings.Trim(strings.TrimSpace(v), `"'`)
				if _, exists := os.LookupEnv(k); !exists {
					os.Setenv(k, v)
				}
			}
			return
		}
		dir = filepath.Dir(dir)
	}
}
