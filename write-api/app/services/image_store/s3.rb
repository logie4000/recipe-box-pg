require "aws-sdk-s3"

module ImageStore
  # Objects in an S3 bucket. Credentials come from the usual AWS chain: the
  # EC2 instance role in production, AWS_PROFILE or AWS_ACCESS_KEY_ID in
  # development. This app needs s3:PutObject, s3:DeleteObject and s3:GetObject
  # (plus s3:ListBucket for images:copy); the read-api only s3:GetObject.
  class S3
    CONTENT_TYPES = { "jpg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp" }.freeze

    attr_reader :bucket, :prefix, :client

    # endpoint is only for S3-compatible servers (S3Mock, MinIO) in development.
    def initialize(bucket:, prefix: "", region: nil, endpoint: nil, client: nil)
      raise ArgumentError, "IMAGE_STORAGE=s3 needs IMAGE_S3_BUCKET" if bucket.blank?

      @bucket = bucket
      @prefix = prefix.to_s
      @client = client || Aws::S3::Client.new(
        { region: region.presence, endpoint: endpoint.presence, force_path_style: endpoint.present? || nil }.compact
      )
    end

    def write(key, bytes)
      client.put_object(bucket:, key: object_key(key), body: bytes, content_type: CONTENT_TYPES.fetch(File.extname(key).delete(".")))
    end

    def delete(key)
      client.delete_object(bucket:, key: object_key(key))
    end

    def exist?(key)
      client.head_object(bucket:, key: object_key(key))
      true
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      false
    end

    def read(key) = client.get_object(bucket:, key: object_key(key)).body.read

    def each_key
      return enum_for(:each_key) unless block_given?

      client.list_objects_v2(bucket:, prefix: "#{prefix}recipes/").each do |page|
        page.contents.each do |object|
          key = object.key.delete_prefix(prefix)
          yield key if ImageStore.valid_key?(key)
        end
      end
    end

    private
      def object_key(key)
        raise ArgumentError, "invalid image key" unless ImageStore.valid_key?(key)

        "#{prefix}#{key}"
      end
  end
end
