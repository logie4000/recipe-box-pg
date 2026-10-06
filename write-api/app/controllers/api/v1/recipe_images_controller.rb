module Api
  module V1
    # The photo of the finished dish, one per recipe:
    #
    #   PUT    /api/v1/recipes/:recipe_id/image   multipart field "image"; adds or replaces it
    #   DELETE /api/v1/recipes/:recipe_id/image   removes it
    #
    # The read-api serves it: GET /api/v1/recipes/:id/image for the owner, and
    # GET /api/v1/public/recipes/:public_id/image while the recipe is public.
    # Same owner scoping as RecipesController, so another user's recipe is a 404.
    class RecipeImagesController < ApplicationController
      rate_limit to: Rails.configuration.x.rate_limit_uploads_per_minute, within: 1.minute, only: :update,
        name: "uploads", by: -> { current_user_sub }, with: :render_rate_limited, store: RATE_LIMIT_STORE

      rescue_from RecipeImage::Invalid do |e|
        render_image_error(e.message)
      end

      def update
        recipe = find_recipe
        upload = params.require(:image)
        return render_image_error("Choose an image file.") unless upload.respond_to?(:read)
        return render_image_error("The image is larger than #{RecipeImage::MAX_BYTES / 1.megabyte} MB.") if upload.size > RecipeImage::MAX_BYTES

        image = RecipeImage.clean(upload.read)
        lock_current_user!
        return render_image_error(over_storage_message) if over_storage?(recipe, image.bytes.bytesize)

        key = RecipeImage.new_key(image.extension)
        store.write(key, image.bytes)
        # The request runs in one transaction. If it rolls back, the new file
        # is an orphan; the model deletes the replaced one only after commit.
        ActiveRecord::Base.current_transaction.after_rollback { store.delete(key) }
        recipe.update!(image_key: key, image_bytes: image.bytes.bytesize)

        render json: { id: recipe.id, recipe: recipe }
      end

      def destroy
        recipe = find_recipe
        recipe.update!(image_key: nil, image_bytes: nil)

        render json: { id: recipe.id, recipe: recipe }
      end

      private
        def find_recipe
          Recipe.owned_by(current_user_sub).find(params[:recipe_id]).tap { |recipe| authorize recipe, :update? }
        end

        def store = ImageStore.current

        # This photo plus the user's other photos (the one it replaces doesn't count).
        def over_storage?(recipe, bytes)
          Recipe.owned_by(current_user_sub).where.not(id: recipe.id).sum(:image_bytes) + bytes > storage_limit
        end

        def storage_limit = Rails.configuration.x.photo_storage_per_user

        def over_storage_message
          "Your photos use all of your #{storage_limit / 1.megabyte} MB. Remove some photos to add more."
        end

        def render_image_error(message)
          render json: { error: "invalid", errors: { image: [ message ] } }, status: :unprocessable_content
        end
    end
  end
end
