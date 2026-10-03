require "rails_helper"

# The photo of the finished dish. Files go to a throwaway directory; the
# read-api serving them is tested in server/internal/api.
RSpec.describe "/api/v1/recipes/:recipe_id/image" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }
  let(:dir) { Dir.mktmpdir("recipe-images") }
  let(:store) { ImageStore::LocalDisk.new(dir) }
  let!(:recipe) { DbContext.with(user_id: "alice-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Pancakes") } }

  JPEG = "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00".b + ("\x00".b * 64)
  PNG = "\x89PNG\r\n\x1A\n".b + ("\x00".b * 64)
  WEBP = "RIFF\x24\x00\x00\x00WEBPVP8 ".b + ("\x00".b * 64)

  before { ImageStore.current = store }

  after do
    ImageStore.current = nil
    FileUtils.rm_rf(dir)
  end

  def upload(bytes, filename: "dish.jpg", content_type: "image/jpeg")
    file = Rack::Test::UploadedFile.new(StringIO.new(bytes), content_type, original_filename: filename)
    { image: file }
  end

  def image_key = DbContext.with(user_id: "alice-sub") { recipe.reload.image_key }

  def stored_files = Dir.glob("#{dir}/**/*").select { |f| File.file?(f) }

  it "stores a JPEG, PNG or WebP under a fresh random key and returns the recipe" do
    { JPEG => "jpg", PNG => "png", WEBP => "webp" }.each do |bytes, ext|
      put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(bytes)

      expect(response).to have_http_status(:ok)
      key = response.parsed_body["recipe"]["image_key"]
      expect(key).to match(%r{\Arecipes/[A-Za-z0-9]{24}\.#{ext}\z})
      expect(image_key).to eq(key)
      expect(File.binread(File.join(dir, key))).to eq(bytes)
    end
    expect(stored_files.size).to eq(1)
  end

  it "goes by the bytes, not the file name or Content-Type" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice,
        params: upload(PNG, filename: "photo.jpg", content_type: "image/jpeg")
    expect(response.parsed_body["recipe"]["image_key"]).to end_with(".png")

    svg = %(<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>)
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice,
        params: upload(svg, filename: "dish.jpg", content_type: "image/jpeg")
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]["image"]).to be_present
    expect(image_key).to end_with(".png")
  end

  it "deletes the replaced file once the new one is saved" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
    first = image_key
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(PNG)

    expect(image_key).not_to eq(first)
    expect(store.exist?(first)).to be(false)
    expect(stored_files).to eq([ File.join(dir, image_key) ])
  end

  it "removes the photo with DELETE" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
    key = image_key

    delete "/api/v1/recipes/#{recipe.id}/image", headers: alice
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["recipe"]["image_key"]).to be_nil
    expect(store.exist?(key)).to be(false)
  end

  it "deletes the photo along with the recipe" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
    key = image_key

    delete "/api/v1/recipes/#{recipe.id}", headers: alice
    expect(response).to have_http_status(:ok)
    expect(store.exist?(key)).to be(false)
  end

  it "rejects files over the size limit and stores nothing" do
    stub_const("RecipeImage::MAX_BYTES", 32)
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)

    expect(response).to have_http_status(:unprocessable_content)
    expect(stored_files).to be_empty
  end

  it "rejects a missing or non-file image field" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: {}
    expect(response).to have_http_status(:bad_request)

    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: { image: "not a file" }
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "answers 404 to anyone but the owner and writes nothing" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: bob, params: upload(JPEG)
    expect(response).to have_http_status(:not_found)
    delete "/api/v1/recipes/#{recipe.id}/image", headers: bob
    expect(response).to have_http_status(:not_found)

    expect(stored_files).to be_empty
    expect(image_key).to be_nil
  end

  it "requires a token" do
    put "/api/v1/recipes/#{recipe.id}/image", params: upload(JPEG)
    expect(response).to have_http_status(:unauthorized)
  end

  it "only accepts keys in the storage format" do
    record = DbContext.with(user_id: "alice-sub") { recipe.reload.tap { |r| r.image_key = "../../etc/passwd" } }
    expect(record).not_to be_valid
    expect { store.delete("../outside.jpg") }.to raise_error(ArgumentError)
  end
end
