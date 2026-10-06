require "rails_helper"

# Fixtures are 40×30 images saved by Pillow with EXIF (camera make and GPS
# position) and, where the format has one, a comment.
RSpec.describe RecipeImage do
  def fixture(name) = file_fixture("images/#{name}").binread

  def png(width, height, extra_chunks = [])
    chunk = ->(type, data) { [ data.bytesize ].pack("N") + type + data + [ Zlib.crc32(type + data) ].pack("N") }
    "\x89PNG\r\n\x1A\n".b + chunk.("IHDR", [ width, height, 8, 2, 0, 0, 0 ].pack("NNC5")) +
      extra_chunks.map { |type, data| chunk.(type, data.b) }.join.b +
      chunk.("IDAT", Zlib::Deflate.deflate("\0" * 4)) + chunk.("IEND", "")
  end

  {
    "photo.jpg" => "jpg", "progressive.jpg" => "jpg", "photo.png" => "png",
    "photo.webp" => "webp", "lossless.webp" => "webp"
  }.each do |name, extension|
    it "accepts #{name}, reads its size and drops its metadata" do
      cleaned = described_class.clean(fixture(name))

      expect(cleaned).to have_attributes(extension: extension, width: 40, height: 30)
      expect(cleaned.bytes).not_to include("SecretCam")
      expect(cleaned.bytes).not_to include("secret comment")
      expect(cleaned.bytes).not_to include("Exif")
      expect(cleaned.bytes.bytesize).to be <= fixture(name).bytesize
    end

    it "cuts off anything glued after the end of #{name}" do
      cleaned = described_class.clean(fixture(name) + "PK\x03\x04 hidden zip".b)

      expect(cleaned.bytes).not_to include("hidden zip")
      expect(described_class.clean(cleaned.bytes).bytes).to eq(cleaned.bytes)
    end

    it "refuses #{name} cut short" do
      bytes = fixture(name)
      expect { described_class.clean(bytes.byteslice(0, bytes.bytesize / 2)) }
        .to raise_error(RecipeImage::Invalid, "The image file is damaged.")
    end
  end

  it "keeps the JPEG's JFIF header and image data intact" do
    cleaned = described_class.clean(fixture("photo.jpg")).bytes

    expect(cleaned.byteslice(0, 2)).to eq("\xFF\xD8".b)
    expect(cleaned).to include("JFIF\0")
    expect(cleaned.byteslice(-2, 2)).to eq("\xFF\xD9".b)
  end

  it "clears the EXIF flag in a WebP's VP8X header" do
    original = fixture("photo.webp")
    expect(original.getbyte(20) & 0x08).not_to eq(0)

    cleaned = described_class.clean(original).bytes
    expect(cleaned.byteslice(12, 4)).to eq("VP8X")
    expect(cleaned.getbyte(20) & 0x0C).to eq(0)
    expect(cleaned.byteslice(4, 4).unpack1("V")).to eq(cleaned.bytesize - 8)
  end

  it "drops PNG text chunks but keeps the colour ones" do
    cleaned = described_class.clean(png(2, 2, [ [ "tEXt", "Author\0Rob" ], [ "sRGB", "\0" ] ])).bytes

    expect(cleaned).not_to include("tEXt")
    expect(cleaned).to include("sRGB")
  end

  it "refuses a PNG with a bad checksum" do
    bytes = png(2, 2)
    bytes.setbyte(30, bytes.getbyte(30) ^ 0xFF)

    expect { described_class.clean(bytes) }.to raise_error(RecipeImage::Invalid, "The image file is damaged.")
  end

  it "refuses images too large in pixels, however small the file" do
    expect { described_class.clean(png(10_001, 10)) }.to raise_error(RecipeImage::Invalid, /too big \(10001 × 10 pixels\)/)
    expect { described_class.clean(png(9_000, 9_000)) }.to raise_error(RecipeImage::Invalid, /too big/)
    expect(described_class.clean(png(8_000, 6_000)).width).to eq(8_000)
  end

  it "refuses anything that isn't JPEG, PNG or WebP" do
    [ "GIF89a", "<svg xmlns='http://www.w3.org/2000/svg'/>", "%PDF-1.7", "" ].each do |bytes|
      expect { described_class.clean(bytes) }.to raise_error(RecipeImage::Invalid, "Use a JPEG, PNG or WebP image.")
    end
  end

  it "refuses a bare signature" do
    [ "\xFF\xD8\xFF\xE0".b + ("\0".b * 64), "\x89PNG\r\n\x1A\n".b + ("\0".b * 64), "RIFF\x24\0\0\0WEBPVP8 ".b + ("\0".b * 64) ].each do |bytes|
      expect { described_class.clean(bytes) }.to raise_error(RecipeImage::Invalid, "The image file is damaged.")
    end
  end
end
