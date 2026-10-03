package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/logie4000/webapp-template/server/internal/db/sqlc"
)

// Loads write-api/db/structure.sql into a throwaway Postgres 16, recreates the
// app_reader grants the Rails migration would make, and checks the read-only
// guarantees end to end. Skipped with -short or when Docker is unavailable.
func TestReaderRoleEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test (-short)")
	}
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx := context.Background()

	schema, err := os.ReadFile(filepath.Join("..", "..", "..", "write-api", "db", "structure.sql"))
	if err != nil {
		t.Fatal(err)
	}

	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("app"),
		postgres.WithUsername("app_owner"),
		postgres.WithPassword("owner"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })

	ownerURL, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := pgx.Connect(ctx, ownerURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close(ctx)

	// Schema + the grants from db/migrate/*_create_app_roles.rb (structure.sql
	// carries no grants). The container superuser is not app_owner-without-
	// BYPASSRLS, so RLS is checked through app_reader below.
	for _, stmt := range []string{
		string(schema),
		"CREATE ROLE app_reader LOGIN PASSWORD 'reader'",
		"ALTER ROLE app_reader SET default_transaction_read_only = on",
		"GRANT USAGE ON SCHEMA public TO app_reader",
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reader",
		"INSERT INTO notes (title, body, author_sub, created_at, updated_at) VALUES ('hello', '', 'seed', now(), now())",
		"INSERT INTO private_notes (owner_sub, body, created_at, updated_at) VALUES ('alice', 'a', now(), now()), ('bob', 'b', now(), now())",
		"INSERT INTO recipes (id, public_id, owner_sub, title, ingredients, directions, is_public, created_at, updated_at) VALUES " +
			"(1, '" + pancakesPublicID + "', 'alice', 'Pancakes', '{2 eggs,milk}', '{Whisk,Fry}', false, now(), now()), " +
			"(2, '" + soupPublicID + "', 'alice', 'Soup', '{}', '{}', true, now(), now()), " +
			"(3, '" + chiliPublicID + "', 'bob', 'Chili', '{beans}', '{Simmer}', false, now(), now())",
	} {
		if _, err := owner.Exec(ctx, stmt); err != nil {
			t.Fatalf("setup %q: %v", firstLine(stmt), err)
		}
	}

	readerURL := strings.Replace(ownerURL, "app_owner:owner@", "app_reader:reader@", 1)
	pool, err := NewPool(ctx, readerURL, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	t.Run("reads work", func(t *testing.T) {
		err := ReadTx(ctx, pool, RequestContext{UserID: "alice"}, func(q *sqlc.Queries) error {
			notes, err := q.ListNotes(ctx, sqlc.ListNotesParams{PageLimit: 10})
			if err != nil {
				return err
			}
			if len(notes) != 1 || notes[0].Title != "hello" {
				return fmt.Errorf("notes = %+v", notes)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})

	t.Run("writes are refused", func(t *testing.T) {
		_, err := pool.Exec(ctx, "INSERT INTO notes (title, body, author_sub, created_at, updated_at) VALUES ('x', '', 'x', now(), now())")
		if err == nil {
			t.Fatal("insert succeeded as app_reader")
		}
	})

	testRecipes(ctx, t, pool)

	t.Run("RLS limits private notes to the caller", func(t *testing.T) {
		for user, want := range map[string]int{"alice": 1, "bob": 1, "": 0} {
			err := ReadTx(ctx, pool, RequestContext{UserID: user}, func(q *sqlc.Queries) error {
				rows, err := q.ListPrivateNotes(ctx)
				if err != nil {
					return err
				}
				if len(rows) != want {
					return fmt.Errorf("user %q saw %d rows, want %d", user, len(rows), want)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		}
	})
}

const (
	pancakesPublicID = "6f1d2c3b-0a4e-4b5f-9c6d-7e8f9a0b1c2d"
	soupPublicID     = "1b2c3d4e-5f60-4718-89ab-cdef01234567"
	chiliPublicID    = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
)

func mustUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		t.Fatal(err)
	}
	return u
}

func testRecipes(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Run("recipes: each owner sees only their own", func(t *testing.T) {
		for user, want := range map[string]int{"alice": 2, "bob": 1, "": 0} {
			err := ReadTx(ctx, pool, RequestContext{UserID: user}, func(q *sqlc.Queries) error {
				rows, err := q.ListRecipes(ctx, sqlc.ListRecipesParams{OwnerSub: user, Limit: 10})
				if err != nil {
					return err
				}
				if len(rows) != want {
					return fmt.Errorf("user %q listed %d recipes, want %d", user, len(rows), want)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		}
	})

	t.Run("recipes: RLS hides other owners' private rows even if the query asks for them", func(t *testing.T) {
		err := ReadTx(ctx, pool, RequestContext{UserID: "bob"}, func(q *sqlc.Queries) error {
			// Asking for alice's rows while signed in as bob: only her public one.
			rows, err := q.ListRecipes(ctx, sqlc.ListRecipesParams{OwnerSub: "alice", Limit: 10})
			if err != nil {
				return err
			}
			if len(rows) != 1 || rows[0].ID != 2 {
				return fmt.Errorf("bob saw %+v of alice's recipes, want only public recipe 2", rows)
			}
			if _, err := q.GetRecipe(ctx, sqlc.GetRecipeParams{ID: 1, OwnerSub: "alice"}); !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("bob GetRecipe(alice's 1) err = %v, want no rows", err)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})

	t.Run("recipes: a public recipe can be read without a user, private ones cannot", func(t *testing.T) {
		err := ReadTx(ctx, pool, RequestContext{}, func(q *sqlc.Queries) error {
			r, err := q.GetPublicRecipe(ctx, mustUUID(t, soupPublicID))
			if err != nil {
				return err
			}
			if r.Title != "Soup" {
				return fmt.Errorf("public recipe = %+v", r)
			}
			for _, id := range []string{pancakesPublicID, chiliPublicID, "00000000-0000-4000-8000-000000000000"} {
				if _, err := q.GetPublicRecipe(ctx, mustUUID(t, id)); !errors.Is(err, pgx.ErrNoRows) {
					return fmt.Errorf("recipe %s: err = %v, want no rows", id, err)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})

	t.Run("recipes: RLS alone exposes only public rows to anonymous readers", func(t *testing.T) {
		err := ReadTx(ctx, pool, RequestContext{}, func(q *sqlc.Queries) error {
			// ListRecipes has no is_public filter; RLS must still hide private rows.
			rows, err := q.ListRecipes(ctx, sqlc.ListRecipesParams{OwnerSub: "alice", Limit: 10})
			if err != nil {
				return err
			}
			if len(rows) != 1 || rows[0].ID != 2 {
				return fmt.Errorf("anonymous listed %+v, want only public recipe 2", rows)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}
