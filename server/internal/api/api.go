// Package api wires the read-only HTTP routes. Only GET routes exist; the
// ServeMux answers anything else with 405.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/logie4000/webapp-template/server/internal/auth"
	"github.com/logie4000/webapp-template/server/internal/db"
	"github.com/logie4000/webapp-template/server/internal/db/sqlc"
	"github.com/logie4000/webapp-template/server/internal/httpx"
	"github.com/logie4000/webapp-template/server/internal/storage"
)

type Server struct {
	Pool             *pgxpool.Pool
	Verifier         *auth.Verifier
	Tenants          auth.TenantResolver
	Log              *slog.Logger
	MinClientVersion string
	AppVersion       string
	CORSOrigins      []string
	Images           storage.Store
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /readyz", s.readyz)
	mux.HandleFunc("GET /api/v1/meta", s.meta)
	mux.HandleFunc("GET /api/v1/public/recipes/{public_id}", s.getPublicRecipe)
	mux.HandleFunc("GET /api/v1/public/recipes/{public_id}/image", s.getPublicRecipeImage)

	// Authenticated (+ tenant when TENANT_MODE=on)
	protected := func(h http.HandlerFunc) http.Handler {
		return s.Verifier.Require(s.Tenants.Middleware(h))
	}
	mux.Handle("GET /api/v1/me", protected(s.me))
	mux.Handle("GET /api/v1/notes", protected(s.listNotes))
	mux.Handle("GET /api/v1/notes/{id}", protected(s.getNote))
	mux.Handle("GET /api/v1/private-notes", protected(s.listPrivateNotes))
	mux.Handle("GET /api/v1/recipes", protected(s.listRecipes))
	mux.Handle("GET /api/v1/recipes/{id}", protected(s.getRecipe))
	mux.Handle("GET /api/v1/recipes/{id}/image", protected(s.getRecipeImage))

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

// The caller's own collection: the queries filter on owner_sub, and RLS hides
// other users' private rows anyway. Someone else's id is a 404 here, even when
// that recipe is public (public reads use /api/v1/public/recipes/{public_id}).
func (s *Server) listRecipes(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 20, 1, 100)
	offset := queryInt(r, "offset", 0, 0, 1_000_000)
	owner := auth.UserFrom(r.Context()).Subject

	var (
		items []sqlc.ListRecipesRow
		total int64
	)
	err := db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		var err error
		if items, err = q.ListRecipes(r.Context(), sqlc.ListRecipesParams{OwnerSub: owner, Limit: int32(limit), Offset: int32(offset)}); err != nil {
			return err
		}
		total, err = q.CountRecipes(r.Context(), owner)
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) getRecipe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "id must be an integer")
		return
	}
	var recipe sqlc.GetRecipeRow
	err = db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		recipe, err = q.GetRecipe(r.Context(), sqlc.GetRecipeParams{ID: id, OwnerSub: auth.UserFrom(r.Context()).Subject})
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, recipe)
}

// publicIDPattern matches Recipe.generate_public_id in the write-api
// (SecureRandom.alphanumeric(12)).
var publicIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{12}$`)

// getPublicRecipe needs no login. It looks recipes up by public_id, a random
// 12-character code, never the sequential id, so public recipes can't be
// found by counting. It runs with no user, so RLS only lets is_public rows through
// (recipes_public_read), and the query asks for that explicitly too.
// Malformed codes and private, missing or deleted recipes all get the same 404.
func (s *Server) getPublicRecipe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	publicID := r.PathValue("public_id")
	if !publicIDPattern.MatchString(publicID) {
		httpx.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	var recipe sqlc.GetPublicRecipeRow
	err := db.ReadTx(r.Context(), s.Pool, db.RequestContext{}, func(q *sqlc.Queries) error {
		var err error
		recipe, err = q.GetPublicRecipe(r.Context(), publicID)
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, recipe)
}

// getRecipeImage is the owner's photo of one of their recipes. Browsers can't
// put a bearer token on an <img>, so the web app fetches it as a blob.
func (s *Server) getRecipeImage(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "id must be an integer")
		return
	}
	var key pgtype.Text
	err = db.ReadTx(r.Context(), s.Pool, requestContext(r), func(q *sqlc.Queries) error {
		key, err = q.GetRecipeImageKey(r.Context(), sqlc.GetRecipeImageKeyParams{ID: id, OwnerSub: auth.UserFrom(r.Context()).Subject})
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-cache")
	s.serveImage(w, r, key)
}

// getPublicRecipeImage is the photo on the shared page, with the same rules
// as getPublicRecipe: no login, public recipes only, one 404 for everything
// else. no-cache (not no-store) lets browsers keep it but ask again each time,
// so making the recipe private hides the photo at once too.
func (s *Server) getPublicRecipeImage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	publicID := r.PathValue("public_id")
	if !publicIDPattern.MatchString(publicID) {
		httpx.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	var key pgtype.Text
	err := db.ReadTx(r.Context(), s.Pool, db.RequestContext{}, func(q *sqlc.Queries) error {
		var err error
		key, err = q.GetPublicRecipeImageKey(r.Context(), publicID)
		return err
	})
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.serveImage(w, r, key)
}

// serveImage sends the stored photo. Keys are new for every upload, so the
// key is the ETag and unchanged photos come back as 304s. The headers stop
// browsers from treating the bytes as anything but an image.
func (s *Server) serveImage(w http.ResponseWriter, r *http.Request, key pgtype.Text) {
	if !key.Valid || s.Images == nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	obj, err := s.Images.Open(r.Context(), key.String)
	if errors.Is(err, storage.ErrNotFound) {
		s.Log.Warn("image missing from storage", "key", key.String)
		httpx.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if err != nil {
		s.Log.Error("image storage", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "internal", "storage error")
		return
	}
	defer obj.Body.Close()

	h := w.Header()
	h.Set("Content-Type", storage.ContentType(key.String))
	h.Set("ETag", `"`+path.Base(key.String)+`"`)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	http.ServeContent(w, r, "", obj.ModTime, obj.Body)
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
