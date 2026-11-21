module Api
  module V1
    # Getting in:
    #
    #   POST   /api/v1/account-requests              the caller asks to be let in (the web
    #                                                app does this on sign-in for an
    #                                                account without a role)
    #   POST   /api/v1/account-requests/code         email the caller a new code
    #   POST   /api/v1/account-requests/verify       { code }: the caller proves their email
    #   POST   /api/v1/account-requests/:id/approve  admin: grant reader, drop the request
    #   DELETE /api/v1/account-requests/:id          admin: disable the account, drop it
    #
    # An account whose email is already verified (Google sign-in) is let in
    # straight away. A password sign-up is emailed a six-digit code, and is
    # let in when it enters it. Without MAIL_FROM no codes go out, and sign-ups
    # wait for an admin, who can also approve anyone still waiting. Admins
    # list them with GET /api/v1/account-requests on the read-api.
    #
    # The caller's own replies carry status: "approved" (in; refresh the token
    # to pick up the role), "verify" (enter the emailed code) or "pending" (an
    # admin decides). Keycloak is called before the row goes, so if it fails
    # the request stays.
    class AccountRequestsController < ApplicationController
      APPROVED_ROLE = "reader"

      class CodeNotSent < StandardError; end

      rescue_from KeycloakAdmin::Error do |e|
        Rails.logger.error(e.message)
        render json: { error: "keycloak", message: "Couldn't reach the sign-in server. Try again." }, status: :bad_gateway
      end

      rescue_from CodeNotSent do
        render json: { error: "email", message: "Couldn't send the email. Try again in a little while." }, status: :bad_gateway
      end

      rescue_from AccountRequest::TooSoon do |e|
        render json: { error: "too_soon", message: e.message }, status: :too_many_requests
      end

      def create
        authorize AccountRequest
        return render json: { status: "approved" } if current_user.reader?
        return let_in if current_user.email_verified?

        account_request = AccountRequest.find_or_initialize_by(user_sub: current_user_sub)
        created = account_request.new_record?
        account_request.update!(email: current_user.email.to_s.first(255), name: current_user.name.to_s.first(255))
        # The first code goes out on sign-in; a lapsed one is replaced. Within
        # the limits only: past them the user can ask with "Send a new code".
        if verifying? && !account_request.code_live?
          begin
            send_code(account_request)
          rescue AccountRequest::TooSoon, CodeNotSent
            nil
          end
        end
        render json: status_for(account_request), status: created ? :created : :ok
      end

      def code
        authorize AccountRequest
        return render json: { status: "approved" } if current_user.reader?

        account_request = own_request
        return render json: status_for(account_request) unless verifying?

        send_code(account_request)
        render json: status_for(account_request)
      end

      def verify
        authorize AccountRequest
        return render json: { status: "approved" } if current_user.reader?

        account_request = own_request
        unless account_request.check_code!(params.require(:code), current_user.email)
          return render json: { error: "invalid_code", message: account_request.code_rejection }, status: :unprocessable_content
        end

        unless KeycloakAdmin.current.mark_email_verified(current_user_sub, account_request.code_email)
          return render json: { error: "email_changed", message: "Your email address changed. Send a new code." }, status: :conflict
        end

        let_in(account_request)
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
        # RLS shows the caller only their own.
        def own_request = AccountRequest.find_by!(user_sub: current_user_sub)

        def find_request
          AccountRequest.find(params[:id]).tap { |r| authorize r }
        end

        def verifying? = Rails.configuration.x.mail_from.present? && current_user.email.present?

        # Verified email (Google, or the right code): let them in, and drop any
        # request they filed before. RLS lets them delete their own row.
        def let_in(account_request = AccountRequest.find_by(user_sub: current_user_sub))
          KeycloakAdmin.current.grant_realm_role(current_user_sub, APPROVED_ROLE)
          account_request&.destroy!
          render json: { status: "approved" }
        end

        def send_code(account_request)
          code = account_request.issue_code!(current_user.email)
          AccountRequestMailer.verification_code(email: current_user.email, name: current_user.name, code: code).deliver_now
        rescue AccountRequest::TooSoon
          raise
        rescue StandardError => e
          Rails.logger.error("verification email to account request #{account_request.id}: #{e.class}: #{e.message}")
          # No email, no code: let the user ask again straight away.
          account_request.update_columns(code_digest: nil, code_sent_at: nil)
          raise CodeNotSent
        end

        def status_for(account_request)
          return { status: "pending", account_request: account_request } unless verifying?

          {
            status: "verify",
            account_request: account_request,
            email: current_user.email,
            code_sent_at: (account_request.code_sent_at if account_request.code_live?)
          }
        end
    end
  end
end
