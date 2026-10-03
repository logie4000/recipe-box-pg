module Api
  module W
    module V1
      module Recipes
        # POST   /api/w/v1/recipes/:recipe_id/share  creates or regenerates the token
        # DELETE /api/w/v1/recipes/:recipe_id/share  revokes it
        #
        # The share link itself is served by the read-api without login:
        # GET /api/v1/shared/recipes/:share_token
        class SharesController < ApplicationController
          before_action :load_recipe

          def create
            @recipe.regenerate_share_token!
            render json: { id: @recipe.id, share_token: @recipe.share_token }, status: :created
          end

          def destroy
            @recipe.revoke_share_token!
            render json: { id: @recipe.id, share_token: nil }
          end

          private
            def load_recipe
              @recipe = Recipe.owned_by(current_user_sub).find(params[:recipe_id])
              authorize @recipe, :share?
            end
        end
      end
    end
  end
end
