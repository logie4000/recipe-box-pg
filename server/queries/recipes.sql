-- name: ListRecipes :many
SELECT id, public_id, title, ingredients, directions, notes, image_key, is_public, created_at, updated_at
FROM recipes
WHERE owner_sub = $1
ORDER BY lower(title), id
LIMIT $2 OFFSET $3;

-- name: CountRecipes :one
SELECT count(*) FROM recipes
WHERE owner_sub = $1;

-- name: GetRecipe :one
SELECT id, public_id, title, ingredients, directions, notes, image_key, is_public, created_at, updated_at
FROM recipes
WHERE id = $1 AND owner_sub = $2;

-- name: GetPublicRecipe :one
SELECT public_id, title, author_name, ingredients, directions, notes, image_key, created_at, updated_at
FROM recipes
WHERE public_id = $1 AND is_public;

-- name: GetRecipeImageKey :one
SELECT image_key FROM recipes
WHERE id = $1 AND owner_sub = $2;

-- name: GetPublicRecipeImageKey :one
SELECT image_key FROM recipes
WHERE public_id = $1 AND is_public;

-- Every shared recipe on the site, the caller's own included, by title.
-- Counts instead of the lists keep the response small.
-- name: ListSharedRecipes :many
SELECT public_id, title, author_name, image_key,
       cardinality(ingredients)::int AS ingredient_count,
       cardinality(directions)::int AS direction_count,
       (owner_sub = sqlc.arg(caller_sub)::text) AS mine,
       updated_at
FROM recipes
WHERE is_public
ORDER BY lower(title), id
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountSharedRecipes :one
SELECT count(*) FROM recipes WHERE is_public;

-- The caller's bookmarks of shared recipes, by title. Recipes that are no
-- longer shared drop out (and come back if shared again).
-- name: ListSavedRecipes :many
SELECT r.public_id, r.title, r.author_name, r.image_key,
       cardinality(r.ingredients)::int AS ingredient_count,
       cardinality(r.directions)::int AS direction_count,
       s.created_at AS saved_at
FROM saved_recipes s
JOIN recipes r ON r.id = s.recipe_id
WHERE s.user_sub = $1 AND r.is_public
ORDER BY lower(r.title), r.id;

-- Whether the caller owns or has saved one shared recipe.
-- name: GetSavedStatus :one
SELECT (r.owner_sub = sqlc.arg(caller_sub)::text) AS mine,
       EXISTS (
         SELECT 1 FROM saved_recipes s
         WHERE s.recipe_id = r.id AND s.user_sub = sqlc.arg(caller_sub)::text
       ) AS saved
FROM recipes r
WHERE r.public_id = sqlc.arg(public_id) AND r.is_public;
