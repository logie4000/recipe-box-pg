# Role-based defaults. `user` is an AuthUser (token claims).
# Roles (Keycloak realm roles): reader < editor < admin.
class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    @user = user
    @record = record
  end

  def create? = user.editor?
  def update? = user.editor?
  def destroy? = user.editor?
end
