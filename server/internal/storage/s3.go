package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// S3 reads photos from a bucket. Credentials come from the usual AWS chain:
// the EC2 instance role in production, AWS_PROFILE or AWS_ACCESS_KEY_ID in
// development.
type S3 struct {
	Client *s3.Client
	Bucket string
	Prefix string
}

func NewS3(ctx context.Context, o Options) (*S3, error) {
	if o.Bucket == "" {
		return nil, errors.New("IMAGE_STORAGE=s3 needs IMAGE_S3_BUCKET")
	}
	var opts []func(*awsconfig.LoadOptions) error
	if o.Region != "" {
		opts = append(opts, awsconfig.WithRegion(o.Region))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	client := s3.NewFromConfig(cfg, func(so *s3.Options) {
		if o.Endpoint != "" {
			so.BaseEndpoint = aws.String(o.Endpoint)
			so.UsePathStyle = true
		}
	})
	return &S3{Client: client, Bucket: o.Bucket, Prefix: o.Prefix}, nil
}

func (b *S3) Open(ctx context.Context, key string) (*Object, error) {
	if !ValidKey(key) {
		return nil, ErrNotFound
	}
	out, err := b.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.Bucket),
		Key:    aws.String(b.Prefix + key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound") {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &Object{Body: out.Body, Size: aws.ToInt64(out.ContentLength), ModTime: aws.ToTime(out.LastModified)}, nil
}
