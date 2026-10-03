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
      def update
        recipe = find_recipe
        upload = params.require(:image)
        return render_image_error("Choose an image file.") unless upload.respond_to?(:read)
        return render_image_error("The image is larger than #{RecipeImage::MAX_BYTES / 1.megabyte} MB.") if upload.size > RecipeImage::MAX_BYTES

        bytes = upload.read
        extension = RecipeImage.extension_for(bytes)
        return render_image_error("Use a JPEG, PNG or WebP image.") unless extension

        key = RecipeImage.new_key(extension)
        store.write(key, bytes)
        # The request runs in one transaction. If it rolls back, the new file
        # is an orphan; the model deletes the replaced one only after commit.
        ActiveRecord::Base.current_transaction.after_rollback { store.delete(key) }
        recipe.update!(image_key: key)

        render json: { id: recipe.id, recipe: recipe }
      end

      def destroy
        recipe = find_recipe
        recipe.update!(image_key: nil)

        render json: { id: recipe.id, recipe: recipe }
      end

      private
        def find_recipe
          Recipe.owned_by(current_user_sub).find(params[:recipe_id]).tap { |recipe| authorize recipe, :update? }
        end

        def store = ImageStore.current

        def render_image_error(message)
          render json: { error: "invalid", errors: { image: [ message ] } }, status: :unprocessable_content
        end
    end
  end
end
