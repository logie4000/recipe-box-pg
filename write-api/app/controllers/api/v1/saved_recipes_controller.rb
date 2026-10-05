module Api
  module V1
    # Saving (bookmarking) a shared recipe, by its public_id. Writes only; the
    # read-api lists them at GET /api/v1/saved-recipes. Private, unknown and
    # deleted recipes are all the same 404, as on the public recipe page.
    class SavedRecipesController < ApplicationController
      def create
        authorize SavedRecipe
        recipe = Recipe.find_by!(public_id: params.expect(:public_id), is_public: true)
        if recipe.owner_sub == current_user_sub
          return render json: { error: "invalid", errors: { recipe: [ "is already yours" ] } }, status: :unprocessable_content
        end

        saved = SavedRecipe.create_or_find_by!(user_sub: current_user_sub, recipe: recipe)
        render json: { public_id: recipe.public_id, saved: true, saved_at: saved.created_at }, status: :created
      end

      # Idempotent: removing a bookmark that isn't there is fine.
      def destroy
        authorize SavedRecipe
        recipe_ids = Recipe.where(public_id: params[:id]).select(:id)
        SavedRecipe.where(user_sub: current_user_sub, recipe_id: recipe_ids).destroy_all

        render json: { public_id: params[:id], saved: false }
      end
    end
  end
end
