// Package storage opens recipe photos. The Rails write-api writes and
// deletes them (write-api/app/services/image_store.rb); this service only
// reads, so in containers its volume is mounted read-only, and on S3 it only
// needs s3:GetObject.
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
	Body    io.ReadCloser
	Size    int64
	ModTime time.Time
}

// Store is where photos are read from, the same place the write-api's
// ImageStore backend writes them.
type Store interface {
	Open(ctx context.Context, key string) (*Object, error)
}

// Options picks and configures the backend (IMAGE_STORAGE and friends).
type Options struct {
	Kind     string // "local" (default) or "s3"
	Dir      string // local: IMAGE_STORAGE_DIR
	Bucket   string // s3: IMAGE_S3_BUCKET
	Prefix   string // s3: IMAGE_S3_PREFIX, put in front of every key
	Region   string // s3: AWS_REGION
	Endpoint string // s3: IMAGE_S3_ENDPOINT, only for S3-compatible servers such as MinIO
}

// New returns the backend named by IMAGE_STORAGE.
func New(ctx context.Context, o Options) (Store, error) {
	switch o.Kind {
	case "", "local":
		return LocalDisk{Root: o.Dir}, nil
	case "s3":
		return NewS3(ctx, o)
	default:
		return nil, fmt.Errorf("IMAGE_STORAGE=%s is not supported", o.Kind)
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
