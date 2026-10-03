# Recipes: data model, owner isolation, public or private

## Table

`recipes` (migration `write-api/db/migrate/20261003150000_create_recipes.rb`)

| Column | Type | Notes |
|---|---|---|
| `owner_sub` | varchar, not null | Keycloak `sub` of the owner. Set from the token and never accepted from the request body. |
| `title` | varchar, not null | 1 to 200 characters |
| `ingredients` | text[], default `{}` | ordered list. Items are stripped and blank ones dropped. Up to 200 items of 2,000 characters each. |
| `directions` | text[], default `{}` | ordered steps, same rules as `ingredients` |
| `image_key` | varchar, null | Storage hook for the image drop zone, which comes later. The API doesn't let clients set it yet, so nobody can point it at someone else's object. |
| `is_public` | boolean, not null, default `false` | Private unless the owner makes it public. |

## Isolation (one owner per recipe)

Isolation is enforced in three places, so one forgotten filter does not leak data:

1. **Application filter.** Rails looks rows up with `Recipe.owned_by(current_user_sub)`.
   The Go queries for "my recipes" filter on `owner_sub = <token sub>`.
2. **Row-level security.** The `recipes_owner` policy (`FOR ALL`, with
   `FORCE ROW LEVEL SECURITY`) allows only `owner_sub = app.user_id`, which each
   request transaction sets from the verified token. An unset or empty value
   matches nothing.
3. **Response shape.** Another user's id is **404**, never 403, so ids reveal
   nothing. `owner_sub` is never returned.

## Public or private

- New recipes are private. The owner flips the flag with
  `PATCH /api/v1/recipes/:id` and `{recipe: {is_public: true}}` (or `false` to
  hide the recipe again, which takes effect immediately).
- Anyone can read a public recipe without logging in:
  `GET /api/v1/public/recipes/:id` (Go read-api, public route). The response
  has no `owner_sub` and is sent with `Cache-Control: no-store`. Private,
  missing and deleted recipes all return the same 404.
- How it works: the `recipes_public_read` policy is `FOR SELECT USING (is_public)`.
  It only adds read access. Updates and deletes still need `recipes_owner`, so
  a public recipe stays read-only for everyone except its owner.
- Public recipes don't show up in other users' own lists (`GET /api/v1/recipes`
  filters on owner), and they don't show up in the owner-only
  `GET /api/v1/recipes/:id` for anyone else.
- Ids are sequential, so anyone can walk through the public recipes by trying
  ids. That fits "public". If you later want link-only sharing (unlisted),
  add a random slug and use it in the public URL instead of the id.

## Endpoints

All under `/api/v1`. nginx sends GET/HEAD to the Go read-api and writes to
the Rails write-api, so a recipe has one URL for every operation.

| Method + path | Service | Auth | What |
|---|---|---|---|
| `GET /api/v1/recipes?limit=&offset=` | read-api | token | the caller's recipes, newest first: `{items, total, limit, offset}` |
| `GET /api/v1/recipes/:id` | read-api | token | one of the caller's recipes |
| `GET /api/v1/public/recipes/:id` | read-api | none | a public recipe, read-only |
| `POST /api/v1/recipes` | write-api | token | `{recipe: {title, ingredients: [], directions: [], is_public}}` gives 201 `{id, recipe}` |
| `PATCH /api/v1/recipes/:id` | write-api | token | same body, partial update (including `is_public`) |
| `DELETE /api/v1/recipes/:id` | write-api | token | |

Writes require the `reader` realm role, as `private_notes` does. Make sure new
family accounts get it (Keycloak default roles).

## Tests

- `write-api/spec/requests/api/v1/recipes_spec.rb`: CRUD, 404s for other
  users on every write, RLS checked directly in the database, private by
  default, public reads without login, public stays read-only, switching back
  to private hides the recipe again.
- `server/internal/api/api_test.go`: the recipe routes need a token; the
  public route doesn't, and only answers GET.
- `server/internal/db/db_integration_test.go`: as `app_reader` against the
  real schema, covering per-owner listing, RLS when a query asks for another
  owner's rows, and public versus private reads without a user
  (testcontainers, needs Docker).
