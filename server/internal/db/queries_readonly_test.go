package db

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Guard rail: every statement in server/queries must be a plain SELECT (or
// WITH ... SELECT). Writes belong in the Rails write-api. The database role
// would refuse them anyway; this fails fast, in review, instead of at runtime.
var forbidden = regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|CALL|DO|LOCK|VACUUM|REFRESH|SET\s+ROLE|FOR\s+UPDATE|FOR\s+SHARE|nextval|setval|pg_advisory_lock)\b`)

func TestQueriesAreReadOnly(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "queries", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no query files found (err=%v)", err)
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(raw), "\n") {
			code, _, _ := strings.Cut(line, "--") // ignore comments
			if m := forbidden.FindString(code); m != "" {
				t.Errorf("%s:%d: %q is not allowed in read-api queries", filepath.Base(f), i+1, m)
			}
		}
	}
}
