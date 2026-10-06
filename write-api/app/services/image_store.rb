# Where photos of finished dishes live. This app writes and deletes them; the
# Go read-api only opens them (server/internal/storage), so both must point at
# the same place.
#
#   IMAGE_STORAGE=local (default)  files under IMAGE_STORAGE_DIR
#                                  (dev: <repo>/storage/images, test: tmp/test-images,
#                                  containers: /srv/images on a shared volume)
#   IMAGE_STORAGE=s3               objects in IMAGE_S3_BUCKET, keys prefixed
#                                  with IMAGE_S3_PREFIX (production)
#
# A backend needs #write, #delete, #exist? and #each_key here and Open in the
# Go store. bin/rails images:copy copies photos from one backend to another.
module ImageStore
  # recipes/<24 random letters and digits>.<ext>. A new key for every upload,
  # so a key never points at different bytes and both sides can refuse
  # anything else (no path tricks).
  KEY_FORMAT = %r{\Arecipes/[A-Za-z0-9]{24}\.(?:jpg|png|webp)\z}

  class << self
    def current = @current ||= backend(ENV.fetch("IMAGE_STORAGE", "local"))
    attr_writer :current

    def valid_key?(key) = KEY_FORMAT.match?(key.to_s)

    # The backend called kind, configured from the environment.
    def backend(kind)
      case kind
      when "local" then LocalDisk.new(Rails.configuration.x.image_storage_dir)
      when "s3" then S3.new(**Rails.configuration.x.image_s3)
      else raise ArgumentError, "IMAGE_STORAGE=#{kind} is not supported"
      end
    end

    # Copies every photo in from that to doesn't have yet (bin/rails
    # images:copy). Keys never point at different bytes, so a photo that is
    # already there is skipped, and running it again picks up where it left off.
    def copy(from:, to:, log: ->(_) { })
      copied = skipped = 0
      from.each_key do |key|
        if to.exist?(key)
          skipped += 1
        else
          to.write(key, from.read(key))
          copied += 1
          log.call("copied #{key}")
        end
      end
      { copied:, skipped: }
    end
  end
end
