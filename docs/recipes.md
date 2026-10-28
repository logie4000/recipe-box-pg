# Recipes: data model, owner isolation, public or private

## Table

`recipes` (migration `write-api/db/migrate/20261003150000_create_recipes.rb`)

| Column | Type | Notes |
|---|---|---|
| `owner_sub` | varchar, not null | Keycloak `sub` of the owner. Set from the token and never accepted from the request body. |
| `title` | varchar, not null | 1 to 200 characters |
| `ingredients` | text[], default `{}` | ordered list. Items are stripped and blank ones dropped. Up to 200 items of 2,000 characters each. |
| `directions` | text[], default `{}` | ordered steps, same rules as `ingredients` |
| `notes` | text, default `''` | free-form notes, trimmed, at most 10,000 characters |
| `image_key` | varchar, null | Where the photo of the finished dish is stored (`recipes/<24 random letters and digits>.jpg` (or `.png`, `.webp`)). Only the image upload endpoint sets it, to a file it just stored, so nobody can point it at someone else's photo. |
| `is_public` | boolean, not null, default `false` | Private unless the owner makes it public. |
| `public_id` | varchar, not null, unique | 12 random letters and digits for the public URL (`SecureRandom.alphanumeric(12)`, e.g. `k7Xq2mP9vR4t`), separate from the table's sequential `id`. The model generates it on create; clients can't set it, and it never changes (`attr_readonly`), even when the recipe is edited or made private and public again. |

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
  `GET /api/v1/public/recipes/:public_id` (Go read-api, public route). The
  owner gets `public_id` in every recipe response, to build the link. The
  public response has no `id` and no `owner_sub`, and is sent with
  `Cache-Control: no-store`. Private, missing and deleted recipes, and
  anything that isn't a 12-character alphanumeric code (such as a sequential
  id), all return the same 404.
- How it works: the `recipes_public_read` policy is `FOR SELECT USING (is_public)`.
  It only adds read access. Updates and deletes still need `recipes_owner`, so
  a public recipe stays read-only for everyone except its owner.
- Public recipes don't show up in other users' own lists (`GET /api/v1/recipes`
  filters on owner), and they don't show up in the owner-only
  `GET /api/v1/recipes/:id` for anyone else.
- The public URL uses `public_id`, about 71 random bits (62^12 possible
  codes), so nobody can find public recipes by counting through sequential
  ids. With 100,000 public recipes, guessing 1,000 codes a second would take
  about 20,000 years to hit one. There is no "list all public recipes"
  endpoint, so in practice a public recipe can only be reached by someone who
  has its link.
- Collisions: the unique index is the check. A uniqueness validation can't
  do it, because RLS hides other users' rows from the query. On the rare
  collision, `Recipe#save_with_unique_public_id` draws a new code inside a
  savepoint and retries, up to 5 times.

## Endpoints

All under `/api/v1`. nginx sends GET/HEAD to the Go read-api and writes to
the Rails write-api, so a recipe has one URL for every operation.

| Method + path | Service | Auth | What |
|---|---|---|---|
| `GET /api/v1/recipes?limit=&offset=` | read-api | token | the caller's recipes, newest first: `{items, total, limit, offset}` |
| `GET /api/v1/recipes/:id` | read-api | token | one of the caller's recipes |
| `GET /api/v1/public/recipes/:public_id` | read-api | none | a public recipe, read-only |
| `POST /api/v1/recipes` | write-api | token | `{recipe: {title, ingredients: [], directions: [], notes, is_public}}` gives 201 `{id, recipe}` |
| `PATCH /api/v1/recipes/:id` | write-api | token | same body, partial update (including `is_public`) |
| `DELETE /api/v1/recipes/:id` | write-api | token | also deletes the photo |
| `PUT /api/v1/recipes/:id/image` | write-api | token | multipart field `image`: adds or replaces the photo, returns `{id, recipe}` |
| `DELETE /api/v1/recipes/:id/image` | write-api | token | removes the photo |
| `GET /api/v1/recipes/:id/image` | read-api | token | the owner's photo |
| `GET /api/v1/public/recipes/:public_id/image` | read-api | none | the photo of a public recipe |

Writes require the `reader` realm role, as `private_notes` does. Make sure new
family accounts get it (Keycloak default roles).

## Photos

One photo of the finished dish per recipe.

- **Storage.** The write-api writes and deletes photos through
  `ImageStore` (`write-api/app/services/image_store.rb`); the read-api only
  opens them (`server/internal/storage`). Both read the same settings:
  - `IMAGE_STORAGE=local` (the default in development) with
    `IMAGE_STORAGE_DIR`: `<repo>/storage/images` (gitignored), or in
    containers the `images` volume at `/srv/images`, mounted read-only into
    the read-api.
  - `IMAGE_STORAGE=s3` (the default in `docker-compose.prod.yml`) with
    `IMAGE_S3_BUCKET`, an optional `IMAGE_S3_PREFIX` and `AWS_REGION`.
    Credentials come from the EC2 instance role (or `AWS_PROFILE` /
    `AWS_ACCESS_KEY_ID` in development). See [Photos on S3](#photos-on-s3).
- **Upload.** The file type comes from the first bytes (JPEG, PNG or WebP;
  never SVG), not the name or Content-Type. Up to 10 MB
  (`RecipeImage::MAX_BYTES`; nginx allows 12 MB). Every upload gets a new
  random key. The replaced file is deleted after the database change commits,
  and the new file is deleted if it rolls back. The web app first shrinks
  photos to 2000px and re-encodes them as JPEG in the browser, which also
  strips EXIF data such as the phone's GPS position.
- **Serving.** Same rules as the recipe itself: the owner's route filters on
  `owner_sub` and RLS, the public route needs `is_public` and a valid code,
  and everything else is one 404. The key is the ETag, so unchanged photos
  are 304s; `Cache-Control: no-cache` makes browsers ask again each time, so
  making a recipe private hides its photo at once. Responses carry
  `nosniff` and a `sandbox` CSP.

## Photos on S3

Production keeps photos in a private S3 bucket. The object key is
`IMAGE_S3_PREFIX` + the photo's key, e.g. `recipe-box/recipes/<24 chars>.jpg`.
The read-api streams photos to the browser rather than redirecting to S3, so
the bucket never needs to be public, the access checks and headers above apply
to every photo, and a 304 doesn't touch S3 at all.

**Bucket.** Create it in `AWS_REGION` with Block Public Access on (the
default), default encryption (SSE-S3, also the default) and **versioning on**.
Add a lifecycle rule that expires noncurrent versions after, say, 30 days.

**Backups.** With versioning, a replaced or deleted photo stays recoverable as
a noncurrent version until that rule expires it, which covers restoring the
nightly database dump to any point inside the window: every `image_key` in it
still has its bytes. S3 itself stores objects redundantly across zones, so
there's no separate photo backup job. For protection against losing the
bucket or the account, add S3 replication to a bucket in another region or
account.

**Instance role.** Both APIs and the backup container use the EC2 instance
role. Attach a policy like this one (with your bucket and prefix):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::my-photos/recipe-box/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-photos",
      "Condition": { "StringLike": { "s3:prefix": "recipe-box/*" } }
    }
  ]
}
```

`s3:ListBucket` is only for `images:copy`, and it also makes a missing photo
a 404 rather than a 403. Containers reach the role through IMDSv2, which needs
a metadata hop limit of 2 on the instance (the Amazon Linux 2023 default).

**Moving existing photos.** `bin/rails images:copy FROM=local TO=s3` copies
every photo the target doesn't have yet and never deletes anything, so it is
safe to repeat. On a server that already has photos on the `images` volume:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env \
  run --rm -e IMAGE_STORAGE=local write-api bin/rails images:copy FROM=local TO=s3
```

Run it once before switching `IMAGE_STORAGE` to `s3`, deploy, then run it
again to pick up photos uploaded in between. From a development machine, set
`IMAGE_S3_BUCKET` and AWS credentials and run it in `write-api/`.

**Trying S3 locally.** Any S3-compatible server works through
`IMAGE_S3_ENDPOINT`, for example
`docker run -p 9090:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=photos adobe/s3mock`
with `IMAGE_STORAGE=s3`, `IMAGE_S3_BUCKET=photos`,
`IMAGE_S3_ENDPOINT=http://127.0.0.1:9090` and any `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. Restart both APIs after changing these.

## Web pages

| Path | What |
|---|---|
| `/recipes` | the user's recipes, newest first, with photos |
| `/recipes/new`, `/recipes/:id/edit` | title, ingredient and step lists (add, remove, reorder; pasting a list splits it into lines), photo |
| `/recipes/:id` | the recipe, a photo drop zone, the Private/Shared switch with a copyable link, Edit and Delete |
| `/r/:public_id` | the shared, read-only page; no login |

An `<img>` can't send a bearer token, so the owner's pages fetch the photo
as a blob; the public page uses the public URL directly.

## Tests

- `write-api/spec/requests/api/v1/recipes_spec.rb`: CRUD, 404s for other
  users on every write, RLS checked directly in the database, private by
  default, public reads without login by `public_id`, public stays read-only,
  switching back to private hides the recipe again, and `public_id` is random,
  unique, can't be set by clients, doesn't change, and is redrawn on a
  collision (with a cap on retries).
- `write-api/spec/requests/api/v1/recipe_images_spec.rb`: upload, type
  sniffing (an SVG named `.jpg` is refused), replace and remove delete the old
  file, deleting the recipe deletes the photo, size limit, 404 for other
  users, and key format checks.
- `server/internal/storage/storage_test.go` and `TestServeImage`: keys outside
  the format never reach the disk; headers, ETag and 304s.
  `s3_integration_test.go` reads from a throwaway S3Mock container (skipped
  without Docker).
- `write-api/spec/services/image_store_spec.rb`: the S3 backend against the
  SDK's stubbed client (prefix, content type, key checks, listing) and
  `ImageStore.copy`.
- `web/src/app/features/recipes/*.spec.ts`: API calls, form, share switch
  and the public page.
- `server/internal/api/api_test.go`: the recipe routes need a token; the
  public route doesn't, only answers GET, and returns 404 for anything that
  isn't 12 letters or digits.
- `server/internal/db/db_integration_test.go`: as `app_reader` against the
  real schema, covering per-owner listing, RLS when a query asks for another
  owner's rows, and public versus private reads without a user
  (testcontainers, needs Docker).

## Import and export

`/recipes/import` reads a dropped file or pasted text in the browser: a
Recipe Box export, schema.org Recipe data (a JSON-LD file or a saved web
page), or plain text with Ingredients / Directions / Notes sections. The
chosen recipes are saved through `POST /api/v1/recipes`, private and without
a photo. `/recipes/export` downloads the recipes you tick as a Recipe Box
file, `{format: "recipe-box", version: 1, recipes: [{title, ingredients, directions, notes}]}`.

To move recipes from the original Recipe Box (specialbrew.net), which has no
export of its own, run `node tools/old-recipe-box-export.mjs [API_BASE]` and
import the file it writes. See the script for the API_BASE to use.
