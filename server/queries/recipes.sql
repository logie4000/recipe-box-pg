-- name: ListRecipes :many
SELECT id, public_id, title, ingredients, directions, notes, image_key, is_public, created_at, updated_at
FROM recipes
WHERE owner_sub = $1
ORDER BY created_at DESC, id DESC
LIMIT $2 OFFSET $3;

-- name: CountRecipes :one
SELECT count(*) FROM recipes
WHERE owner_sub = $1;

-- name: GetRecipe :one
SELECT id, public_id, title, ingredients, directions, notes, image_key, is_public, created_at, updated_at
FROM recipes
WHERE id = $1 AND owner_sub = $2;

-- name: GetPublicRecipe :one
SELECT public_id, title, ingredients, directions, notes, image_key, created_at, updated_at
FROM recipes
WHERE public_id = $1 AND is_public;

-- name: GetRecipeImageKey :one
SELECT image_key FROM recipes
WHERE id = $1 AND owner_sub = $2;

-- name: GetPublicRecipeImageKey :one
SELECT image_key FROM recipes
WHERE public_id = $1 AND is_public;
