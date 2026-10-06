require "rails_helper"

# The S3 backend against the SDK's stubbed client (no network), and copying
# between backends. The read-api side is tested against an S3-compatible
# server in server/internal/storage/s3_integration_test.go.
RSpec.describe ImageStore do
  let(:key) { "recipes/abcdefghijklmnopqrstuvwx.jpg" }

  describe ImageStore::S3 do
    let(:client) { Aws::S3::Client.new(stub_responses: true, region: "us-east-1") }
    let(:store) { described_class.new(bucket: "photos", prefix: "app/", client:) }

    it "writes, reads and deletes objects under the prefix" do
      client.stub_responses(:get_object, body: "jpeg bytes")

      store.write(key, "jpeg bytes")
      expect(store.read(key)).to eq("jpeg bytes")
      store.delete(key)

      put, get, delete = client.api_requests.map { it[:params] }
      expect(put).to include(bucket: "photos", key: "app/#{key}", body: "jpeg bytes", content_type: "image/jpeg")
      expect(get).to include(bucket: "photos", key: "app/#{key}")
      expect(delete).to include(bucket: "photos", key: "app/#{key}")
    end

    it "says whether an object exists" do
      client.stub_responses(:head_object, [ {}, "NotFound" ])

      expect(store.exist?(key)).to be(true)
      expect(store.exist?(key)).to be(false)
    end

    it "lists stored keys without the prefix, ignoring anything outside the key format" do
      client.stub_responses(:list_objects_v2, contents: [
        { key: "app/#{key}" }, { key: "app/recipes/notes.txt" }
      ])

      expect(store.each_key.to_a).to eq([ key ])
      expect(client.api_requests.last[:params]).to include(bucket: "photos", prefix: "app/recipes/")
    end

    it "refuses keys outside the format" do
      %w[../secret.jpg recipes/abc.jpg recipes/abcdefghijklmnopqrstuvwx.svg].each do |bad|
        expect { store.write(bad, "x") }.to raise_error(ArgumentError)
        expect { store.delete(bad) }.to raise_error(ArgumentError)
      end
      expect(client.api_requests).to be_empty
    end

    it "needs a bucket" do
      expect { described_class.new(bucket: "", client:) }.to raise_error(ArgumentError, /IMAGE_S3_BUCKET/)
    end
  end

  describe ".copy" do
    let(:from_dir) { Dir.mktmpdir("images-from") }
    let(:to_dir) { Dir.mktmpdir("images-to") }
    let(:from) { ImageStore::LocalDisk.new(from_dir) }
    let(:to) { ImageStore::LocalDisk.new(to_dir) }
    let(:other) { "recipes/zyxwvutsrqponmlkjihgfedc.png" }

    after { FileUtils.rm_rf([ from_dir, to_dir ]) }

    it "copies the photos the target doesn't have yet and leaves the source alone" do
      from.write(key, "one")
      from.write(other, "two")
      to.write(other, "two")
      File.write(File.join(from_dir, "recipes", "stray.txt"), "not a photo")

      expect(described_class.copy(from:, to:)).to eq(copied: 1, skipped: 1)
      expect(to.read(key)).to eq("one")
      expect(to.each_key.to_a).to eq([ key, other ].sort)
      expect(from.each_key.to_a).to eq([ key, other ].sort)

      expect(described_class.copy(from:, to:)).to eq(copied: 0, skipped: 2)
    end
  end
end
