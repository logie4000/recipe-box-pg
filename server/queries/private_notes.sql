-- name: ListPrivateNotes :many
SELECT id, body, created_at, updated_at
FROM private_notes
ORDER BY created_at DESC, id DESC
LIMIT 100;
