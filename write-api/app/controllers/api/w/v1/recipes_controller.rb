module Api
  module W
    module V1
      # Writes only. Reads go to the Go read-api: GET /api/v1/recipes(/:id).
      # Lookups are scoped to the caller (and RLS backs that up), so another
      # user's recipe is a 404, never a 403.
      class RecipesController < ApplicationController
        def create
          authorize Recipe
          recipe = Recipe.new(recipe_params.merge(owner_sub: current_user_sub))
          return render_errors(recipe) unless recipe.save

          render json: { id: recipe.id, recipe: recipe }, status: :created
        end

        def update
          recipe = Recipe.owned_by(current_user_sub).find(params[:id])
          authorize recipe
          return render_errors(recipe) unless recipe.update(recipe_params)

          render json: { id: recipe.id, recipe: recipe }
        end

        def destroy
          recipe = Recipe.owned_by(current_user_sub).find(params[:id])
          authorize recipe
          recipe.destroy!

          render json: { id: recipe.id }
        end

        private
          # image_key is deliberately not permitted: the upload flow will set it.
          def recipe_params
            params.expect(recipe: [ :title, ingredients: [], directions: [] ])
          end
      end
    end
  end
end
