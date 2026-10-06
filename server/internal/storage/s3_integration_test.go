package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Reads photos from a throwaway S3Mock (an S3-compatible server; it accepts
// any credentials). Skipped with -short or when Docker is unavailable.
func TestS3OpensStoredObjects(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test (-short)")
	}
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx := context.Background()

	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "adobe/s3mock:latest",
			ExposedPorts: []string{"9090/tcp"},
			WaitingFor:   wait.ForListeningPort("9090/tcp"),
		},
		Started: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ctr.Terminate(context.Background()) })
	endpoint, err := ctr.PortEndpoint(ctx, "9090/tcp", "http")
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
	store, err := NewS3(ctx, Options{Bucket: "photos", Prefix: "/app", Region: "us-east-1", Endpoint: endpoint})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String("photos")}); err != nil {
		t.Fatal(err)
	}
	_, err = store.Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String("photos"),
		Key:    aws.String("app/" + key),
		Body:   bytes.NewReader([]byte("jpeg bytes")),
	})
	if err != nil {
		t.Fatal(err)
	}

	obj, err := store.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(obj.Body)
	obj.Body.Close()
	if string(body) != "jpeg bytes" || obj.Size != 10 || obj.ModTime.IsZero() {
		t.Fatalf("got %q (%d bytes, modified %v)", body, obj.Size, obj.ModTime)
	}

	// Missing objects, keys outside the format, and the key without the prefix.
	for _, k := range []string{"recipes/zzzzzzzzzzzzzzzzzzzzzzzz.jpg", "app/" + key, "../" + key} {
		if _, err := store.Open(ctx, k); !errors.Is(err, ErrNotFound) {
			t.Errorf("Open(%q) err = %v, want ErrNotFound", k, err)
		}
	}
}
