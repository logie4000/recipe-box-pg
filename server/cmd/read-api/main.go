// Command read-api serves GET /api/v1/* from Postgres as the read-only role
// app_reader. All writes go to the Rails write-api.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/logie4000/webapp-template/server/internal/api"
	"github.com/logie4000/webapp-template/server/internal/auth"
	"github.com/logie4000/webapp-template/server/internal/config"
	"github.com/logie4000/webapp-template/server/internal/db"
	"github.com/logie4000/webapp-template/server/internal/httpx"
	"github.com/logie4000/webapp-template/server/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("read-api stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	var handler slog.Handler = slog.NewJSONHandler(os.Stdout, nil)
	if cfg.LogFormat == "text" {
		handler = slog.NewTextHandler(os.Stdout, nil)
	}
	log := slog.New(handler)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	images, err := storage.New(cfg.ImageStorage, cfg.ImageStorageDir)
	if err != nil {
		return err
	}

	srv := &api.Server{
		Pool:             pool,
		Verifier:         auth.NewVerifier(context.Background(), cfg.OIDCIssuer, cfg.OIDCAudience, cfg.OIDCJWKSURL),
		Tenants:          auth.TenantResolver{Enabled: cfg.TenantMode, Subdomains: cfg.TenantSubdomains},
		Log:              log,
		MinClientVersion: cfg.MinClientVersion,
		AppVersion:       cfg.AppVersion,
		CORSOrigins:      cfg.CORSAllowedOrigins,
		Images:           images,
		AnonymousLimit:   httpx.NewRateLimiter(cfg.RateLimitAnonymous, cfg.RateLimitAnonymousBurst),
		SignedInLimit:    httpx.NewRateLimiter(cfg.RateLimitSignedIn, cfg.RateLimitSignedInBurst),
	}

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("read-api listening", "addr", cfg.Addr, "issuer", cfg.OIDCIssuer, "tenant_mode", cfg.TenantMode)
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}
