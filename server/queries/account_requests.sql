-- name: ListAccountRequests :many
-- Sign-ups waiting for approval, oldest first. RLS shows all of them only to
-- admins (app.is_admin = 'on'); anyone else sees at most their own.
SELECT id, email, name, created_at
FROM account_requests
ORDER BY created_at, id
LIMIT 200;
