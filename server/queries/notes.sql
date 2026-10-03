-- name: ListNotes :many
SELECT id, title, body, author_sub, created_at, updated_at
FROM notes
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountNotes :one
SELECT count(*) FROM notes;

-- name: GetNote :one
SELECT id, title, body, author_sub, created_at, updated_at
FROM notes
WHERE id = $1;
