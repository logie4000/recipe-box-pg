# An uploaded photo of the finished dish. The type comes from the file's
# bytes, never from its name or the Content-Type the client sent, and only
# JPEG, PNG and WebP are accepted (no SVG, which could carry script).
#
# The web app resizes photos to at most 2000px and re-encodes them as JPEG
# before uploading, which also drops EXIF data such as GPS position. Other
# clients can send anything, so RecipeImage.clean checks every upload here:
#
# - the file must parse as a whole: every JPEG segment, PNG chunk (with its
#   CRC) and WebP chunk, ending at the end-of-image marker. Anything after it
#   (a ZIP glued on to make a polyglot, say) is cut off.
# - at most MAX_SIDE pixels a side and MAX_PIXELS in all, so a small file
#   can't decompress to gigabytes in a viewer's browser.
# - metadata is dropped: JPEG APPn segments other than JFIF, ICC colour
#   profile and Adobe, and comments; PNG text, time and eXIf chunks; WebP
#   EXIF and XMP. That removes GPS position, camera serials and comments.
#
# The pixel data itself isn't decoded (there is no image library on the
# server); the read-api serves photos with nosniff and a sandbox CSP.
module RecipeImage
  MAX_BYTES = 10.megabytes
  MAX_SIDE = 10_000
  MAX_PIXELS = 50_000_000

  class Invalid < StandardError; end

  Cleaned = Data.define(:extension, :width, :height, :bytes)

  module_function

  # The upload, checked and stripped of metadata, or Invalid with a message
  # for the user.
  def clean(bytes)
    bytes = bytes.b
    extension, parser =
      if bytes.start_with?("\xFF\xD8\xFF".b) then [ "jpg", Jpeg ]
      elsif bytes.start_with?("\x89PNG\r\n\x1A\n".b) then [ "png", Png ]
      elsif bytes.byteslice(0, 4) == "RIFF" && bytes.byteslice(8, 4) == "WEBP" then [ "webp", Webp ]
      else raise Invalid, "Use a JPEG, PNG or WebP image."
      end
    width, height, cleaned = parser.clean(bytes)

    damaged! unless width.to_i.positive? && height.to_i.positive?
    if width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS
      raise Invalid, "The image is too big (#{width} × #{height} pixels). Use one at most #{MAX_SIDE} pixels a side."
    end

    Cleaned.new(extension:, width:, height:, bytes: cleaned)
  rescue RangeError, ArgumentError, TypeError, NoMethodError
    # A length pointing past the end, or a header cut short.
    damaged!
  end

  def new_key(extension) = "recipes/#{SecureRandom.alphanumeric(24)}.#{extension}"

  def damaged! = raise(Invalid, "The image file is damaged.")

  # Segments up to the first scan, then entropy-coded data, which may be
  # followed by more segments and scans (progressive JPEG), up to EOI.
  module Jpeg
    SOF = [ *0xC0..0xCF ] - [ 0xC4, 0xC8, 0xCC ]
    KEEP_APP = {
      0xE0 => "JFIF\0".b,         # JFIF header
      0xE2 => "ICC_PROFILE\0".b,  # colour profile
      0xEE => "Adobe".b           # colour transform
    }.freeze

    module_function

    def clean(bytes)
      out = +"\xFF\xD8".b
      pos = 2
      width = height = nil
      in_scan = false

      loop do
        if in_scan
          # Entropy data: copy up to the next real marker. FF00 is a stuffed
          # FF, FFD0-FFD7 are restart markers.
          start = pos
          loop do
            pos = bytes.index("\xFF".b, pos) || RecipeImage.damaged!
            following = bytes.getbyte(pos + 1) || RecipeImage.damaged!
            break unless following.zero? || following.between?(0xD0, 0xD7)

            pos += 2
          end
          out << bytes.byteslice(start, pos - start)
          in_scan = false
        end

        RecipeImage.damaged! unless bytes.getbyte(pos) == 0xFF
        pos += 1 while bytes.getbyte(pos + 1) == 0xFF # fill bytes before a marker
        marker = bytes.getbyte(pos + 1) || RecipeImage.damaged!
        pos += 2

        if marker == 0xD9 # EOI: anything after it is dropped
          out << "\xFF\xD9".b
          break
        end
        RecipeImage.damaged! if marker == 0xD8 || marker == 0x01 || marker.between?(0xD0, 0xD7)

        length = bytes.byteslice(pos, 2).unpack1("n") || RecipeImage.damaged!
        RecipeImage.damaged! if length < 2 || pos + length > bytes.bytesize
        segment = bytes.byteslice(pos, length)
        payload = segment.byteslice(2..)
        pos += length

        if SOF.include?(marker)
          height, width = payload.byteslice(1, 4).unpack("nn")
        elsif marker == 0xDA # SOS
          RecipeImage.damaged! unless width
          in_scan = true
        end
        next if metadata?(marker, payload)

        out << "\xFF".b << marker.chr << segment
      end

      [ width, height, out ]
    end

    def metadata?(marker, payload)
      return true if marker == 0xFE # COM
      return false unless marker.between?(0xE0, 0xEF)

      prefix = KEEP_APP[marker]
      !(prefix && payload.start_with?(prefix))
    end
  end

  module Png
    # Image data and how to show it. Everything else (tEXt, zTXt, iTXt, eXIf,
    # tIME, private chunks) is dropped.
    KEEP = %w[IHDR PLTE IDAT IEND tRNS gAMA cHRM sRGB iCCP sBIT bKGD pHYs acTL fcTL fdAT].freeze

    module_function

    def clean(bytes)
      out = +"\x89PNG\r\n\x1A\n".b
      pos = 8
      width = height = nil
      seen_idat = false

      loop do
        length, type = bytes.byteslice(pos, 8).unpack("Na4")
        RecipeImage.damaged! if length.nil? || type.nil? || pos + 12 + length > bytes.bytesize
        data = bytes.byteslice(pos + 8, length)
        crc = bytes.byteslice(pos + 8 + length, 4).unpack1("N")
        RecipeImage.damaged! unless Zlib.crc32(type + data) == crc
        RecipeImage.damaged! if pos == 8 && type != "IHDR"

        width, height = data.unpack("NN") if type == "IHDR"
        seen_idat ||= type == "IDAT"
        out << bytes.byteslice(pos, 12 + length) if KEEP.include?(type)
        pos += 12 + length
        break if type == "IEND" # anything after it is dropped
      end

      RecipeImage.damaged! unless seen_idat
      [ width, height, out ]
    end
  end

  module Webp
    # Image data, alpha, animation and colour profile. EXIF, XMP and unknown
    # chunks are dropped, and their flags cleared in VP8X.
    KEEP = [ "VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP" ].freeze
    EXIF_AND_XMP_FLAGS = 0x08 | 0x04

    module_function

    def clean(bytes)
      riff_end = 8 + bytes.byteslice(4, 4).unpack1("V")
      RecipeImage.damaged! if riff_end > bytes.bytesize
      body = +"WEBP".b
      pos = 12
      width = height = nil
      seen_image = false

      while pos < riff_end
        type, size = bytes.byteslice(pos, 8).unpack("a4V")
        RecipeImage.damaged! if size.nil? || pos + 8 + size > riff_end
        data = bytes.byteslice(pos + 8, size)

        case type
        when "VP8X"
          data = data.dup
          data.setbyte(0, data.getbyte(0) & ~EXIF_AND_XMP_FLAGS)
          width = 1 + (data.byteslice(4, 3) + "\0".b).unpack1("V")
          height = 1 + (data.byteslice(7, 3) + "\0".b).unpack1("V")
        when "VP8 "
          RecipeImage.damaged! unless data.byteslice(3, 3) == "\x9D\x01\x2A".b
          w, h = data.byteslice(6, 4).unpack("vv")
          width ||= w & 0x3FFF
          height ||= h & 0x3FFF
          seen_image = true
        when "VP8L"
          RecipeImage.damaged! unless data.getbyte(0) == 0x2F
          bits = data.byteslice(1, 4).unpack1("V")
          width ||= 1 + (bits & 0x3FFF)
          height ||= 1 + ((bits >> 14) & 0x3FFF)
          seen_image = true
        when "ANMF"
          seen_image = true
        end

        if KEEP.include?(type)
          body << type << [ size ].pack("V") << data
          body << "\0".b if size.odd?
        end
        pos += 8 + size + (size & 1)
      end

      RecipeImage.damaged! unless seen_image
      [ width, height, "RIFF".b + [ body.bytesize ].pack("V") + body ]
    end
  end
end
