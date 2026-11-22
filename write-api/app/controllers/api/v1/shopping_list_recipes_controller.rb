module Api
  module V1
    # The caller's shopping list: which recipes are on it, by public_id, and
    # how many servings of each. Writes only; the read-api serves the list and
    # its consolidated ingredients at GET /api/v1/shopping-list. A recipe can
    # be added if it is the caller's own or shared; private, unknown and
    # deleted recipes are all the same 404.
    class ShoppingListRecipesController < ApplicationController
      # Adds the recipe, or updates its servings if it is already on the list.
      # Servings default to 1 for a new entry and are left alone when an
      # existing one is added again without them.
      def create
        authorize ShoppingListRecipe
        recipe = Recipe.where(public_id: params.expect(:public_id))
          .where("owner_sub = ? OR is_public", current_user_sub).take!
        lock_current_user!
        entry = ShoppingListRecipe.find_or_initialize_by(user_sub: current_user_sub, recipe: recipe)
        entry.servings = servings_param if params.key?(:servings)
        return render_errors(entry) unless entry.save

        render json: entry_json(recipe.public_id, entry), status: :created
      end

      # 404 unless the recipe is on the caller's list.
      def update
        authorize ShoppingListRecipe
        entry = entries.find_by!(recipe_id: Recipe.where(public_id: params[:public_id]).select(:id))
        entry.servings = servings_param
        return render_errors(entry) unless entry.save

        render json: entry_json(params[:public_id], entry)
      end

      # Idempotent: removing a recipe that isn't on the list is fine.
      def destroy
        authorize ShoppingListRecipe
        entries.where(recipe_id: Recipe.where(public_id: params[:public_id]).select(:id)).delete_all

        render json: { public_id: params[:public_id], on_list: false }
      end

      def clear
        authorize ShoppingListRecipe
        render json: { cleared: entries.delete_all }
      end

      private
        def entries = ShoppingListRecipe.where(user_sub: current_user_sub)

        # A scalar (number or numeric string); anything else, including a
        # missing value on PATCH, fails the numericality validation as a 422.
        def servings_param
          value = params[:servings]
          value.is_a?(String) || value.is_a?(Numeric) ? value : "invalid"
        end

        def entry_json(public_id, entry)
          { public_id: public_id, servings: entry.servings.to_f, on_list: true }
        end
    end
  end
end
