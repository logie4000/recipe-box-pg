-- name: ListRecipes :many
SELECT id, title, ingredients, directions, image_key, share_token, created_at, updated_at
FROM recipes
WHERE owner_sub = $1
ORDER BY created_at DESC, id DESC
LIMIT $2 OFFSET $3;

-- name: CountRecipes :one
SELECT count(*) FROM recipes
WHERE owner_sub = $1;

-- name: GetRecipe :one
SELECT id, title, ingredients, directions, image_key, share_token, created_at, updated_at
FROM recipes
WHERE id = $1 AND owner_sub = $2;

-- name: GetSharedRecipe :one
SELECT id, title, ingredients, directions, image_key, created_at, updated_at
FROM recipes
WHERE share_token = sqlc.arg(share_token)::text;
