# Base for server-rendered /admin pages. Cookie session (set up in
# config/application.rb), CSRF protection on. Any admin gem mounted under
# /admin later should reuse current_admin / require_admin!.
module Admin
  class BaseController < ActionController::Base
    protect_from_forgery with: :exception
    layout "admin"

    before_action :require_admin!
    helper_method :current_admin

    private
      # { "sub", "email", "name", "roles", "expires_at" } or nil
      def current_admin
        return @current_admin if defined?(@current_admin)

        admin = session[:admin]
        @current_admin = admin if admin && Time.at(admin["expires_at"].to_i).future?
      end

      def require_admin!
        return redirect_to(admin_login_path) unless current_admin
        return if Array(current_admin["roles"]).include?(Rails.configuration.x.oidc.admin_role)

        render plain: "Forbidden: the #{Rails.configuration.x.oidc.admin_role} role is required.", status: :forbidden
      end
  end
end
