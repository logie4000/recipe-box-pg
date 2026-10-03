# An uploaded photo of the finished dish. The type comes from the file's first
# bytes, never from its name or the Content-Type the client sent, and only
# JPEG, PNG and WebP are accepted (no SVG, which could carry script).
#
# The web app resizes photos to at most 2000px and re-encodes them as JPEG
# before uploading, which also drops EXIF data such as GPS position. Other
# clients get what they send, up to MAX_BYTES.
module RecipeImage
  MAX_BYTES = 10.megabytes

  SIGNATURES = {
    "jpg" => ->(b) { b.start_with?("\xFF\xD8\xFF".b) },
    "png" => ->(b) { b.start_with?("\x89PNG\r\n\x1A\n".b) },
    "webp" => ->(b) { b.byteslice(0, 4) == "RIFF" && b.byteslice(8, 4) == "WEBP" }
  }.freeze

  module_function

  # "jpg", "png", "webp", or nil for anything else.
  def extension_for(bytes)
    head = bytes.byteslice(0, 16).to_s.b
    SIGNATURES.find { |_, matches| matches.call(head) }&.first
  end

  def new_key(extension) = "recipes/#{SecureRandom.alphanumeric(24)}.#{extension}"
end
