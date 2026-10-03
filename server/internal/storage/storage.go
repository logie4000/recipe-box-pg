// Package storage opens recipe photos. The Rails write-api writes and
// deletes them (write-api/app/services/image_store.rb); this service only
// reads, so in containers its volume is mounted read-only.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"regexp"
	"time"
)

// ErrNotFound covers missing files and keys that aren't in the storage format.
var ErrNotFound = errors.New("storage: not found")

// keyPattern matches ImageStore::KEY_FORMAT in the write-api: a fresh random
// name per upload, so a key never points at different bytes.
var keyPattern = regexp.MustCompile(`^recipes/[A-Za-z0-9]{24}\.(jpg|png|webp)$`)

var contentTypes = map[string]string{
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
}

func ValidKey(key string) bool { return keyPattern.MatchString(key) }

// ContentType comes from the key's extension, which the write-api chose from
// the file's own bytes.
func ContentType(key string) string { return contentTypes[path.Ext(key)] }

// Object is an open photo. Body must be closed.
type Object struct {
	Body    io.ReadSeekCloser
	Size    int64
	ModTime time.Time
}

// Store is where photos are read from. Another backend (S3, say) implements
// Open next to the write-api's ImageStore backend.
type Store interface {
	Open(ctx context.Context, key string) (*Object, error)
}

// New returns the backend named by IMAGE_STORAGE.
func New(kind, dir string) (Store, error) {
	switch kind {
	case "", "local":
		return LocalDisk{Root: dir}, nil
	default:
		return nil, fmt.Errorf("IMAGE_STORAGE=%s is not supported", kind)
	}
}

// LocalDisk reads files under Root (a directory shared with the write-api).
type LocalDisk struct {
	Root string
}

func (d LocalDisk) Open(_ context.Context, key string) (*Object, error) {
	if !ValidKey(key) {
		return nil, ErrNotFound
	}
	// OpenInRoot refuses to leave Root, on top of the key check.
	f, err := os.OpenInRoot(d.Root, key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &Object{Body: f, Size: st.Size(), ModTime: st.ModTime()}, nil
}
