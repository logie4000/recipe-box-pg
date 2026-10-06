// Package db owns the read-only Postgres pool. Generated queries live in
// ./sqlc (sqlc generate; schema from write-api/db/structure.sql).
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/logie4000/webapp-template/server/internal/db/sqlc"
)

// NewPool connects as app_reader. Besides the role's own grants (SELECT only)
// and ALTER ROLE ... SET default_transaction_read_only, every connection asks
// for read-only transactions again here, and ReadTx opens them read-only.
func NewPool(ctx context.Context, databaseURL string, maxConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
	if _, ok := cfg.ConnConfig.RuntimeParams["application_name"]; !ok {
		cfg.ConnConfig.RuntimeParams["application_name"] = "read-api"
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

// RequestContext is what row-level-security policies see.
type RequestContext struct {
	UserID   string // token sub -> app.user_id
	TenantID string // TENANT_MODE=on -> app.tenant_id
	IsAdmin  bool   // token has the admin role -> app.is_admin = 'on'
}

func adminSetting(admin bool) string {
	if admin {
		return "on"
	}
	return ""
}

// ReadTx runs fn in a read-only transaction with app.user_id / app.tenant_id
// set (transaction-local, so nothing leaks to the next request on the same
// pooled connection).
func ReadTx(ctx context.Context, pool *pgxpool.Pool, rc RequestContext, fn func(q *sqlc.Queries) error) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.is_admin', $3, true)",
		rc.UserID, rc.TenantID, adminSetting(rc.IsAdmin),
	); err != nil {
		return fmt.Errorf("set request context: %w", err)
	}
	if err := fn(sqlc.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
