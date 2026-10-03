# Where photos of finished dishes live. This app writes and deletes them; the
# Go read-api only opens them (server/internal/storage), so both must point at
# the same place.
#
#   IMAGE_STORAGE=local (default)  files under IMAGE_STORAGE_DIR
#                                  (dev: <repo>/storage/images, test: tmp/test-images,
#                                  containers: /srv/images on a shared volume)
#
# Another backend (S3, say) only needs #write, #delete and #exist? here and
# Open in the Go store.
module ImageStore
  # recipes/<24 random letters and digits>.<ext>. A new key for every upload,
  # so a key never points at different bytes and both sides can refuse
  # anything else (no path tricks).
  KEY_FORMAT = %r{\Arecipes/[A-Za-z0-9]{24}\.(?:jpg|png|webp)\z}

  class << self
    def current = @current ||= build
    attr_writer :current

    def valid_key?(key) = KEY_FORMAT.match?(key.to_s)

    private
      def build
        case ENV.fetch("IMAGE_STORAGE", "local")
        when "local" then LocalDisk.new(Rails.configuration.x.image_storage_dir)
        else raise ArgumentError, "IMAGE_STORAGE=#{ENV["IMAGE_STORAGE"]} is not supported"
        end
      end
  end
end
