package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

const key = "recipes/abcdefghijklmnopqrstuvwx.jpg"

func TestLocalDiskOpensStoredFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "recipes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(key)), []byte("jpeg bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	obj, err := LocalDisk{Root: root}.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer obj.Body.Close()
	body, _ := io.ReadAll(obj.Body)
	if string(body) != "jpeg bytes" || obj.Size != 10 {
		t.Fatalf("got %q (%d bytes)", body, obj.Size)
	}
	if ContentType(key) != "image/jpeg" {
		t.Fatalf("content type %q", ContentType(key))
	}
}

func TestLocalDiskRefusesOtherKeys(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "secret.jpg"), []byte("x"), 0o644)
	d := LocalDisk{Root: root}

	for _, k := range []string{
		"recipes/abcdefghijklmnopqrstuvwx.jpg", // valid but missing
		"secret.jpg",
		"../secret.jpg",
		"recipes/../secret.jpg",
		"recipes/abcdefghijklmnopqrstuvwx.svg",
		"recipes/abcdefghijklmnopqrstuv.jpg",
		"/etc/passwd",
	} {
		if _, err := d.Open(context.Background(), k); !errors.Is(err, ErrNotFound) {
			t.Errorf("Open(%q) err = %v, want ErrNotFound", k, err)
		}
	}
}
