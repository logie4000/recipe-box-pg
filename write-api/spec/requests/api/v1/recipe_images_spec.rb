require "rails_helper"

# The photo of the finished dish. Files go to a throwaway directory; the
# read-api serving them is tested in server/internal/api.
RSpec.describe "/api/v1/recipes/:recipe_id/image" do
  let(:alice) { auth_headers(sub: "alice-sub") }
  let(:bob) { auth_headers(sub: "bob-sub") }
  let(:dir) { Dir.mktmpdir("recipe-images") }
  let(:store) { ImageStore::LocalDisk.new(dir) }
  let!(:recipe) { DbContext.with(user_id: "alice-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Pancakes") } }

  # Real 40x30 images with EXIF; spec/models/recipe_image_spec.rb covers the checks.
  JPEG = File.binread(Rails.root.join("spec/fixtures/files/images/photo.jpg"))
  PNG = File.binread(Rails.root.join("spec/fixtures/files/images/photo.png"))
  WEBP = File.binread(Rails.root.join("spec/fixtures/files/images/photo.webp"))

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

  it "stores a JPEG, PNG or WebP, without its metadata, under a fresh random key and returns the recipe" do
    { JPEG => "jpg", PNG => "png", WEBP => "webp" }.each do |bytes, ext|
      put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(bytes)

      expect(response).to have_http_status(:ok)
      key = response.parsed_body["recipe"]["image_key"]
      expect(key).to match(%r{\Arecipes/[A-Za-z0-9]{24}\.#{ext}\z})
      expect(image_key).to eq(key)
      stored = File.binread(File.join(dir, key))
      expect(stored).to eq(RecipeImage.clean(bytes).bytes)
      expect(stored).not_to include("SecretCam")
    end
    expect(stored_files.size).to eq(1)
  end

  it "refuses a damaged or oversized image and stores nothing" do
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG.byteslice(0, 300))
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]["image"]).to eq([ "The image file is damaged." ])

    stub_const("RecipeImage::MAX_SIDE", 39)
    put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(PNG)
    expect(response.parsed_body["errors"]["image"].first).to include("too big (40 × 30 pixels)")

    expect(stored_files).to be_empty
    expect(image_key).to be_nil
  end

  describe "photo storage per user" do
    def image_bytes = DbContext.with(user_id: "alice-sub") { recipe.reload.image_bytes }

    let!(:other) { DbContext.with(user_id: "alice-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Waffles") } }
    let(:jpeg_size) { RecipeImage.clean(JPEG).bytes.bytesize }

    it "records each photo's size, and clears it when the photo goes" do
      put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
      expect(image_bytes).to eq(jpeg_size)

      delete "/api/v1/recipes/#{recipe.id}/image", headers: alice
      expect(image_bytes).to be_nil
    end

    it "refuses a photo that would take the user over the limit, not counting the one it replaces" do
      allow(Rails.configuration.x).to receive(:photo_storage_per_user).and_return(jpeg_size * 2)
      put "/api/v1/recipes/#{other.id}/image", headers: alice, params: upload(JPEG)
      put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
      expect(response).to have_http_status(:ok)

      # Replacing a photo frees its old size first.
      put "/api/v1/recipes/#{recipe.id}/image", headers: alice, params: upload(JPEG)
      expect(response).to have_http_status(:ok)

      third = DbContext.with(user_id: "alice-sub") { Recipe.create!(owner_sub: "alice-sub", title: "Crepes") }
      put "/api/v1/recipes/#{third.id}/image", headers: alice, params: upload(JPEG)
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]["image"].first).to include("Remove some photos")
      expect(stored_files.size).to eq(2)

      # Other users have their own allowance.
      bobs = DbContext.with(user_id: "bob-sub") { Recipe.create!(owner_sub: "bob-sub", title: "Toast") }
      put "/api/v1/recipes/#{bobs.id}/image", headers: bob, params: upload(JPEG)
      expect(response).to have_http_status(:ok)
    end
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
