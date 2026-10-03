# Recipes: data model, owner isolation, share links

## Table

`recipes` (migration `write-api/db/migrate/20261003150000_create_recipes.rb`)

| Column | Type | Notes |
|---|---|---|
| `owner_sub` | varchar, not null | Keycloak `sub` of the owner. Set from the token and never accepted from the request body. |
| `title` | varchar, not null | 1 to 200 characters |
| `ingredients` | text[], default `{}` | ordered list. Items are stripped and blank ones dropped. Up to 200 items of 2,000 characters each. |
| `directions` | text[], default `{}` | ordered steps, same rules as `ingredients` |
| `image_key` | varchar, null | Storage hook for the image drop zone, which comes later. The API doesn't let clients set it yet, so nobody can point it at someone else's object. |
| `share_token` | varchar, null, unique | 32 random bytes, URL-safe base64 (43 chars). `NULL` = not shared. |

## Isolation (one owner per recipe)

Isolation is enforced in three places, so one forgotten filter does not leak data:

1. **Application filter.** Rails looks rows up with `Recipe.owned_by(current_user_sub)`.
   The Go queries filter on `owner_sub = <token sub>`.
2. **Row-level security.** The `recipes_owner` policy (`FOR ALL`, with
   `FORCE ROW LEVEL SECURITY`) allows only `owner_sub = app.user_id`, which each
   request transaction sets from the verified token. An unset or empty value
   matches nothing.
3. **Response shape.** Another user's id is **404**, never 403, so ids reveal
   nothing. `owner_sub` is never returned.

## Share by URL

- The owner creates the token with `POST /api/w/v1/recipes/:id/share`. Posting
  again replaces it and the old link stops working.
  `DELETE /api/w/v1/recipes/:id/share` revokes it.
- Anyone with the link reads that one recipe without logging in:
  `GET /api/v1/shared/recipes/:share_token` (Go read-api, public route). The
  response has no `owner_sub` and no `share_token`, and is sent with
  `Cache-Control: no-store`.
- How it works: that route sets only `app.share_token` (no user). The
  `recipes_shared_read` policy is `FOR SELECT` and matches only
  `share_token = app.share_token`. A share token never allows writes, and it
  never exposes the owner's other recipes. The write-api always clears
  `app.share_token` (`DbContext.apply!`).
- Malformed, unknown and revoked tokens all return the same 404.
- The token is stored in plaintext, so the owner can copy the link again
  later. If a leaked database dump ever becomes part of the threat model
  (public launch), store a SHA-256 digest instead and show the link only once.

## Endpoints

| Method + path | Service | Auth | What |
|---|---|---|---|
| `GET /api/v1/recipes?limit=&offset=` | read-api | token | the caller's recipes, newest first: `{items, total, limit, offset}` |
| `GET /api/v1/recipes/:id` | read-api | token | one of the caller's recipes (includes `share_token`) |
| `GET /api/v1/shared/recipes/:token` | read-api | none | read-only shared recipe |
| `POST /api/w/v1/recipes` | write-api | token | `{recipe: {title, ingredients: [], directions: []}}` gives 201 `{id, recipe}` |
| `PATCH /api/w/v1/recipes/:id` | write-api | token | same body, partial update |
| `DELETE /api/w/v1/recipes/:id` | write-api | token | |
| `POST /api/w/v1/recipes/:id/share` | write-api | token | 201 `{id, share_token}` (creates or regenerates) |
| `DELETE /api/w/v1/recipes/:id/share` | write-api | token | `{id, share_token: null}` |

Writes require the `reader` realm role, as `private_notes` does. Make sure new
family accounts get it (Keycloak default roles).

## Tests

- `write-api/spec/requests/api/w/v1/recipes_spec.rb`: CRUD, 404s for other
  users on every write, RLS checked directly in the database, and share token
  create, regenerate and revoke, including the read-only check.
- `server/internal/api/api_test.go`: the recipe routes need a token; the share
  route is public and rejects malformed tokens.
- `server/internal/db/db_integration_test.go`: as `app_reader` against the
  real schema, covering per-owner listing, RLS even when the query asks for
  another owner, and share-token reads (testcontainers, needs Docker).
