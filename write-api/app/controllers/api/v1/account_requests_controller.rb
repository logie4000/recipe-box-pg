module Api
  module V1
    # Sign-up with approval:
    #
    #   POST   /api/v1/account-requests              the caller asks to be let in (the web
    #                                                app does this on sign-in for an
    #                                                account without a role)
    #   POST   /api/v1/account-requests/:id/approve  admin: grant reader, drop the request
    #   DELETE /api/v1/account-requests/:id          admin: disable the account, drop it
    #
    # Admins list them with GET /api/v1/account-requests on the read-api.
    # Keycloak is called before the row goes, so if it fails the request stays.
    class AccountRequestsController < ApplicationController
      APPROVED_ROLE = "reader"

      rescue_from KeycloakAdmin::Error do |e|
        Rails.logger.error(e.message)
        render json: { error: "keycloak", message: "Couldn't reach the sign-in server. Try again." }, status: :bad_gateway
      end

      def create
        authorize AccountRequest
        return render json: { status: "approved" } if current_user.reader?

        account_request = AccountRequest.find_or_initialize_by(user_sub: current_user_sub)
        created = account_request.new_record?
        account_request.update!(email: current_user.email.to_s.first(255), name: current_user.name.to_s.first(255))
        render json: { status: "pending", account_request: account_request }, status: created ? :created : :ok
      end

      def approve
        account_request = find_request
        KeycloakAdmin.current.grant_realm_role(account_request.user_sub, APPROVED_ROLE)
        account_request.destroy!

        render json: { id: account_request.id }
      end

      def destroy
        account_request = find_request
        KeycloakAdmin.current.disable_user(account_request.user_sub)
        account_request.destroy!

        render json: { id: account_request.id }
      end

      private
        def find_request
          AccountRequest.find(params[:id]).tap { |r| authorize r }
        end
    end
  end
end
