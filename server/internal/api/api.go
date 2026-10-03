// Package api wires the read-only HTTP routes. Only GET routes exist; the
// ServeMux answers anything else with 405.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/logie4000/webapp-template/server/internal/auth"
	"github.com/logie4000/webapp-template/server/internal/db"
	"github.com/logie4000/webapp-template/server/internal/db/sqlc"
	"github.com/logie4000/webapp-template/server/internal/httpx"
)

type Server struct {
	Pool             *pgxpool.Pool
	Verifier         *auth.Verifier
	Tenants          auth.TenantResolver
	Log              *slog.Logger
	MinClientVersion string
	AppVersion       string
	CORSOrigins      []string
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /readyz", s.readyz)
	mux.HandleFunc("GET /api/v1/meta", s.meta)

	// Authenticated (+ tenant when TENANT_MODE=on)
	protected := func(h http.HandlerFunc) http.Handler {
		return s.Verifier.Require(s.Tenants.Middleware(h))
	}
	mux.Handle("GET /api/v1/me", protected(s.me))
	mux.Handle("GET /api/v1/notes", protected(s.listNotes))
	mux.Handle("GET /api/v1/notes/{id}", protected(s.getNote))
	mux.Handle("GET /api/v1/private-notes", protected(s.listPrivateNotes))

	return httpx.Chain(mux,
		httpx.Recover(s.Log),
		httpx.Logger(s.Log),
		httpx.CORS(s.CORSOrigins),
	)
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.Pool.Ping(ctx); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "not_ready", "database unreachable")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// meta lets clients (notably mobile builds) check compatibility before login.
func (s *Server) meta(w http.ResponseWriter, _ *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"api_version":           "v1",
		"server_version":        s.AppVersion,
		"min_supported_version": s.MinClientVersion,
		"tenant_mode":           s.Tenants.Enabled,
	})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	httpx.JSON(w, http.StatusOK, map[string]any{
		"sub":           u.Subject,
		"email":         u.Email,
		"roles":         u.Roles,
		"organizations": u.Organizations,
		"tenant_id":     auth.TenantFrom(r.Context()),
	})
}

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 20, 1, 100)
	offset := queryInt(r, "offset", 0, 0, 1_000_000)

	var (
		items []sqlc.Note
		total int64
	)
	err := db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		var err error
		if items, err = q.ListNotes(r.Context(), sqlc.ListNotesParams{PageLimit: int32(limit), PageOffset: int32(offset)}); err != nil {
			return err
		}
		total, err = q.CountNotes(r.Context())
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) getNote(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "id must be an integer")
		return
	}
	var note sqlc.Note
	err = db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		note, err = q.GetNote(r.Context(), id)
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, note)
}

func (s *Server) listPrivateNotes(w http.ResponseWriter, r *http.Request) {
	var items []sqlc.ListPrivateNotesRow
	err := db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		var err error
		items, err = q.ListPrivateNotes(r.Context())
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func requestContext(r *http.Request) db.RequestContext {
	rc := db.RequestContext{TenantID: auth.TenantFrom(r.Context())}
	if u := auth.UserFrom(r.Context()); u != nil {
		rc.UserID = u.Subject
	}
	return rc
}

func (s *Server) dbError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	s.Log.Error("database", "err", err)
	httpx.Error(w, http.StatusInternalServerError, "internal", "database error")
}

func queryInt(r *http.Request, key string, def, lo, hi int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	return max(lo, min(hi, v))
}
